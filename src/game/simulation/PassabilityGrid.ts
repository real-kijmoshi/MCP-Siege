import { MAP_HEIGHT, MAP_WIDTH } from '../config/battle';
import type { BattleMapId } from '../config/maps';
import type { Vector2D } from '../types/domain';
import { activeBattleMapId, isPassable, terrainAt } from './Zones';

/**
 * The ground, as geometry rather than as names.
 *
 * `Zones` answers what a place is called and `Navigation` chooses which named
 * places an army marches through, because a route over the zone graph is the
 * one that understands roads, crossings and the cost of fighting uphill. That
 * graph is a tactical abstraction, though, and an abstraction has gaps: a mere
 * sitting between two adjacent zone centres, or a barrier cutting a zone in
 * half, is invisible to it. When the graph cannot produce a route the actual
 * ground allows, something has to answer the plainer question — is there *any*
 * way through — and this is what answers it.
 *
 * It is deliberately the fallback and not the primary. A corridor search knows
 * nothing about roads or about which crossing a commander meant; it only knows
 * what a regiment can physically walk on. Consulting it first would quietly
 * throw away the tactical routing that makes the zone graph worth having.
 *
 * The field is derived, immutable once built, and cached per map. Nothing here
 * carries state between ticks, so two engines fighting on two maps in one
 * process cannot disturb each other's ground.
 */

/** Grid resolution. Fine enough to thread a crossing, coarse enough to be free. */
const CELL_SIZE = 50;
const COLUMNS = Math.ceil(MAP_WIDTH / CELL_SIZE);
const ROWS = Math.ceil(MAP_HEIGHT / CELL_SIZE);
const CELL_COUNT = COLUMNS * ROWS;

const SQRT2 = Math.SQRT2;
/** Larger than any real chamfer distance across this grid. */
const FAR = COLUMNS + ROWS + 4;

const NEIGHBOUR_DX = [1, -1, 0, 0, 1, 1, -1, -1] as const;
const NEIGHBOUR_DY = [0, 0, 1, -1, 1, -1, 1, -1] as const;

interface PassabilityField {
  /** 1 where a regiment may stand, 0 where it may not. */
  readonly open: Uint8Array;
  /** World-unit distance from each cell to the nearest ground it cannot use. */
  readonly clearance: Float32Array;
  /** March cost multiplier for the terrain under each cell. */
  readonly cost: Float32Array;
}

const FIELDS = new Map<BattleMapId, PassabilityField>();

function centerX(column: number): number {
  return (column + 0.5) * CELL_SIZE;
}

function centerY(row: number): number {
  return (row + 0.5) * CELL_SIZE;
}

function terrainCostAt(x: number, y: number): number {
  switch (terrainAt(x, y)) {
    case 'forest':
      return 1.34;
    case 'hill':
      return 1.18;
    case 'village':
      return 1.12;
    case 'crossing':
      return 1.2;
    default:
      return 1;
  }
}

/**
 * Two-pass chamfer transform.
 *
 * Every cell learns how far it is from the nearest blocked cell, which turns
 * "will a regiment of this width fit here" into one array read instead of a
 * fresh sampling sweep for every candidate route. Cells beyond the map edge
 * count as blocked, so a route is never smoothed into the border.
 */
function buildClearance(open: Uint8Array): Float32Array {
  const distance = new Float32Array(CELL_COUNT);
  for (let cell = 0; cell < CELL_COUNT; cell += 1) {
    distance[cell] = open[cell] === 1 ? FAR : 0;
  }

  const relax = (cell: number, fromColumn: number, fromRow: number, step: number): void => {
    if (fromColumn < 0 || fromColumn >= COLUMNS || fromRow < 0 || fromRow >= ROWS) {
      // Off the map is impassable, so the edge is always at distance zero.
      if ((distance[cell] ?? FAR) > step) distance[cell] = step;
      return;
    }
    const candidate = (distance[fromRow * COLUMNS + fromColumn] ?? FAR) + step;
    if (candidate < (distance[cell] ?? FAR)) distance[cell] = candidate;
  };

  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const cell = row * COLUMNS + column;
      if (distance[cell] === 0) continue;
      relax(cell, column - 1, row, 1);
      relax(cell, column, row - 1, 1);
      relax(cell, column - 1, row - 1, SQRT2);
      relax(cell, column + 1, row - 1, SQRT2);
    }
  }
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    for (let column = COLUMNS - 1; column >= 0; column -= 1) {
      const cell = row * COLUMNS + column;
      if (distance[cell] === 0) continue;
      relax(cell, column + 1, row, 1);
      relax(cell, column, row + 1, 1);
      relax(cell, column + 1, row + 1, SQRT2);
      relax(cell, column - 1, row + 1, SQRT2);
    }
  }

  for (let cell = 0; cell < CELL_COUNT; cell += 1) {
    distance[cell] = (distance[cell] ?? 0) * CELL_SIZE;
  }
  return distance;
}

function buildField(): PassabilityField {
  const open = new Uint8Array(CELL_COUNT);
  const cost = new Float32Array(CELL_COUNT);
  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const cell = row * COLUMNS + column;
      const x = centerX(column);
      const y = centerY(row);
      if (isPassable(x, y)) {
        open[cell] = 1;
        cost[cell] = terrainCostAt(x, y);
      } else {
        cost[cell] = 1;
      }
    }
  }
  return { open, clearance: buildClearance(open), cost };
}

/**
 * The field for the map currently being fought over.
 *
 * Built on first use rather than at module load: the cost is a few milliseconds
 * per map, and a battle only ever needs the one it is being fought on. Reading
 * the active map rather than taking an id keeps this correct by construction —
 * every caller reaches it through `Navigation`, which the engine has already
 * pointed at its own geography.
 */
function activeField(): PassabilityField {
  const id = activeBattleMapId();
  const existing = FIELDS.get(id);
  if (existing !== undefined) return existing;
  const field = buildField();
  FIELDS.set(id, field);
  return field;
}

function cellOf(x: number, y: number): number {
  const column = Math.min(COLUMNS - 1, Math.max(0, Math.floor(x / CELL_SIZE)));
  const row = Math.min(ROWS - 1, Math.max(0, Math.floor(y / CELL_SIZE)));
  return row * COLUMNS + column;
}

/* ------------------------------------------------------------ search scratch */

/*
 * Preallocated search state. These are scratch buffers in the sense the project
 * allows: `stamp` makes every entry from a previous search unreadable, so a
 * search never observes anything left behind by the one before it, and nothing
 * here survives the call that uses it.
 */
const gScore = new Float64Array(CELL_COUNT);
const fScore = new Float64Array(CELL_COUNT);
const cameFrom = new Int32Array(CELL_COUNT);
const stamp = new Int32Array(CELL_COUNT);
const closed = new Uint8Array(CELL_COUNT);
const heap = new Int32Array(CELL_COUNT + 1);
let currentStamp = 0;
let heapSize = 0;

/** Ties break on cell index so the frontier order never depends on insertion. */
function cheaper(left: number, right: number): boolean {
  const a = fScore[left] ?? 0;
  const b = fScore[right] ?? 0;
  if (a !== b) return a < b;
  return left < right;
}

function heapPush(cell: number): void {
  let child = heapSize;
  heap[heapSize] = cell;
  heapSize += 1;
  while (child > 0) {
    const parent = (child - 1) >> 1;
    const parentCell = heap[parent] ?? 0;
    if (!cheaper(cell, parentCell)) break;
    heap[child] = parentCell;
    heap[parent] = cell;
    child = parent;
  }
}

function heapPop(): number {
  const top = heap[0] ?? -1;
  heapSize -= 1;
  const moved = heap[heapSize] ?? 0;
  if (heapSize > 0) {
    heap[0] = moved;
    let parent = 0;
    for (;;) {
      const left = parent * 2 + 1;
      if (left >= heapSize) break;
      const right = left + 1;
      let best = left;
      if (right < heapSize && cheaper(heap[right] ?? 0, heap[left] ?? 0)) best = right;
      const bestCell = heap[best] ?? 0;
      if (!cheaper(bestCell, moved)) break;
      heap[parent] = bestCell;
      heap[best] = moved;
      parent = best;
    }
  }
  return top;
}

/** Octile distance: exact for 8-connected movement, so the search stays admissible. */
function heuristic(from: number, to: number): number {
  const dx = Math.abs((from % COLUMNS) - (to % COLUMNS));
  const dy = Math.abs(Math.floor(from / COLUMNS) - Math.floor(to / COLUMNS));
  const low = Math.min(dx, dy);
  return (dx + dy - 2 * low + SQRT2 * low) * CELL_SIZE;
}

/**
 * Nearest usable cell to a point.
 *
 * An order may legitimately begin or end on ground a formation cannot occupy —
 * an anchor shoved into a river bank by the press of a melee, or a destination
 * named on the far bank of a mere. Searching from the nearest cell that does
 * satisfy the requirement gives such an order a real answer instead of none.
 */
function nearestUsable(field: PassabilityField, x: number, y: number, required: number): number {
  const origin = cellOf(x, y);
  if ((field.open[origin] ?? 0) === 1 && (field.clearance[origin] ?? 0) >= required) return origin;

  const originColumn = origin % COLUMNS;
  const originRow = Math.floor(origin / COLUMNS);
  for (let ring = 1; ring <= 24; ring += 1) {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let row = originRow - ring; row <= originRow + ring; row += 1) {
      if (row < 0 || row >= ROWS) continue;
      for (let column = originColumn - ring; column <= originColumn + ring; column += 1) {
        if (column < 0 || column >= COLUMNS) continue;
        // Only the newly added ring; the inside was covered by earlier passes.
        if (Math.abs(row - originRow) !== ring && Math.abs(column - originColumn) !== ring) continue;
        const cell = row * COLUMNS + column;
        if ((field.open[cell] ?? 0) !== 1) continue;
        if ((field.clearance[cell] ?? 0) < required) continue;
        const dx = centerX(column) - x;
        const dy = centerY(row) - y;
        const distance = dx * dx + dy * dy;
        // Index order breaks ties so the choice never depends on scan direction.
        if (distance < bestDistance || (distance === bestDistance && cell < best)) {
          bestDistance = distance;
          best = cell;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

function searchCorridor(
  field: PassabilityField,
  from: Vector2D,
  to: Vector2D,
  required: number,
): Vector2D[] | null {
  const start = nearestUsable(field, from.x, from.y, required);
  const goal = nearestUsable(field, to.x, to.y, required);
  if (start < 0 || goal < 0) return null;
  if (start === goal) return [{ x: to.x, y: to.y }];

  currentStamp += 1;
  const searchStamp = currentStamp;
  heapSize = 0;

  stamp[start] = searchStamp;
  closed[start] = 0;
  gScore[start] = 0;
  fScore[start] = heuristic(start, goal);
  cameFrom[start] = -1;
  heapPush(start);

  let found = false;
  while (heapSize > 0) {
    const current = heapPop();
    if (current === goal) {
      found = true;
      break;
    }
    if (closed[current] === 1) continue;
    closed[current] = 1;

    const column = current % COLUMNS;
    const row = Math.floor(current / COLUMNS);
    const currentG = gScore[current] ?? 0;

    for (let step = 0; step < 8; step += 1) {
      const dx = NEIGHBOUR_DX[step] ?? 0;
      const dy = NEIGHBOUR_DY[step] ?? 0;
      const nextColumn = column + dx;
      const nextRow = row + dy;
      if (nextColumn < 0 || nextColumn >= COLUMNS || nextRow < 0 || nextRow >= ROWS) continue;
      const neighbour = nextRow * COLUMNS + nextColumn;
      if ((field.open[neighbour] ?? 0) !== 1) continue;
      if ((field.clearance[neighbour] ?? 0) < required) continue;
      // Corners are not cut: a diagonal is only taken when both cells beside it
      // are usable, so a route never slips through the join of two obstacles.
      if (dx !== 0 && dy !== 0) {
        const sideA = row * COLUMNS + nextColumn;
        const sideB = nextRow * COLUMNS + column;
        if ((field.open[sideA] ?? 0) !== 1 || (field.open[sideB] ?? 0) !== 1) continue;
        if ((field.clearance[sideA] ?? 0) < required) continue;
        if ((field.clearance[sideB] ?? 0) < required) continue;
      }
      if (stamp[neighbour] === searchStamp && closed[neighbour] === 1) continue;

      const span = (dx !== 0 && dy !== 0 ? SQRT2 : 1) * CELL_SIZE;
      const ground = ((field.cost[current] ?? 1) + (field.cost[neighbour] ?? 1)) * 0.5;
      const candidate = currentG + span * ground;
      if (stamp[neighbour] === searchStamp && candidate >= (gScore[neighbour] ?? 0)) continue;

      stamp[neighbour] = searchStamp;
      closed[neighbour] = 0;
      gScore[neighbour] = candidate;
      fScore[neighbour] = candidate + heuristic(neighbour, goal);
      cameFrom[neighbour] = current;
      heapPush(neighbour);
    }
  }

  if (!found) return null;

  const reversed: Vector2D[] = [];
  let cursor = goal;
  // The grid is finite and `cameFrom` is a tree, so this always terminates; the
  // bound is belt and braces against a corrupted search.
  for (let guard = 0; guard <= CELL_COUNT && cursor >= 0; guard += 1) {
    reversed.push({ x: centerX(cursor % COLUMNS), y: centerY(Math.floor(cursor / COLUMNS)) });
    if (cursor === start) break;
    cursor = cameFrom[cursor] ?? -1;
  }
  reversed.reverse();
  // The first cell centre is where the group already stands, and the last is
  // only the cell containing the destination rather than the destination.
  if (reversed.length > 1) reversed.shift();
  reversed[reversed.length - 1] = { x: to.x, y: to.y };
  return reversed;
}

/**
 * A route from `from` to `to` over ground wide enough for the given clearance,
 * or `null` when the two points are genuinely not connected.
 *
 * The result is a dense polyline of cell centres. Callers are expected to run
 * it through line-of-march smoothing, which is what turns it from a staircase
 * into a march.
 */
export function findCorridor(from: Vector2D, to: Vector2D, clearance: number): Vector2D[] | null {
  const field = activeField();
  // A regiment needs its own half-width plus the cell it stands in, but a
  // demand no corridor can satisfy is worse than a tight march, so the
  // requirement relaxes in fixed steps rather than failing outright.
  const demands = [clearance + CELL_SIZE, clearance * 0.5 + CELL_SIZE, CELL_SIZE * 0.5];
  for (const required of demands) {
    const path = searchCorridor(field, from, to, required);
    if (path !== null) return path;
  }
  return null;
}

/** True when a regiment of this clearance can stand at the point at all. */
export function hasStandingRoom(x: number, y: number, clearance: number): boolean {
  const field = activeField();
  const cell = cellOf(x, y);
  return (field.open[cell] ?? 0) === 1 && (field.clearance[cell] ?? 0) >= clearance;
}
