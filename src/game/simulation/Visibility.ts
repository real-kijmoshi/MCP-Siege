import {
  CONTACT_MEMORY_TICKS,
  FOG_CELL_SIZE,
  FOG_COLUMNS,
  FOG_ROWS,
  STRENGTH_ESTIMATE_GRANULARITY,
  UNIT_STATS,
  VISIBILITY_INTERVAL,
} from '../config/battle';
import {
  PLAYER_IDS,
  factionOf,
  opponentOf,
  type PlayerId,
  type UnitCategory,
  type Vector2D,
} from '../types/domain';
import { activeGroups, type GameState } from './GameState';
import { zoneAt } from './Zones';

/**
 * Fog of war and intelligence.
 *
 * This is the enforcement point that keeps the Marshal honest: it may only ever
 * learn what the player could learn. Hidden groups are absent from intelligence
 * entirely, and remembered ones carry a deliberately rounded strength estimate
 * so exact truth never leaks across the boundary.
 */

const UNEXPLORED = 0;
const EXPLORED = 1;
const VISIBLE = 2;

/** Only every Nth unit projects vision; a formation is a blob, not a point. */
const VISION_STRIDE = 6;

function revealCircle(cells: Uint8Array, x: number, y: number, radius: number): void {
  const minColumn = Math.max(0, Math.floor((x - radius) / FOG_CELL_SIZE));
  const maxColumn = Math.min(FOG_COLUMNS - 1, Math.floor((x + radius) / FOG_CELL_SIZE));
  const minRow = Math.max(0, Math.floor((y - radius) / FOG_CELL_SIZE));
  const maxRow = Math.min(FOG_ROWS - 1, Math.floor((y + radius) / FOG_CELL_SIZE));
  const radiusSquared = radius * radius;

  for (let row = minRow; row <= maxRow; row += 1) {
    const centerY = (row + 0.5) * FOG_CELL_SIZE - y;
    const rowOffset = row * FOG_COLUMNS;
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const centerX = (column + 0.5) * FOG_CELL_SIZE - x;
      if (centerX * centerX + centerY * centerY > radiusSquared) continue;
      cells[rowOffset + column] = VISIBLE;
    }
  }
}

export function visibilityAt(state: GameState, playerId: PlayerId, x: number, y: number): number {
  const column = Math.max(0, Math.min(FOG_COLUMNS - 1, Math.floor(x / FOG_CELL_SIZE)));
  const row = Math.max(0, Math.min(FOG_ROWS - 1, Math.floor(y / FOG_CELL_SIZE)));
  return state.visibility[playerId].cells[row * FOG_COLUMNS + column] ?? UNEXPLORED;
}

export function isVisibleTo(state: GameState, playerId: PlayerId, x: number, y: number): boolean {
  return visibilityAt(state, playerId, x, y) === VISIBLE;
}

function recomputeFog(state: GameState, playerId: PlayerId): void {
  const cells = state.visibility[playerId].cells;
  // Anything currently visible falls back to explored before we re-reveal.
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index] === VISIBLE) cells[index] = EXPLORED;
  }

  const units = state.units;
  const faction = factionOf(playerId);
  for (let index = 0; index < units.count; index += 1) {
    if (units.alive[index] !== 1 || units.owner[index] !== faction) continue;
    if (index % VISION_STRIDE !== 0) continue;
    const vision = UNIT_STATS[units.categoryOf(index)].vision;
    revealCircle(cells, units.x[index] ?? 0, units.y[index] ?? 0, vision);
  }
}

/** Rounded so the Marshal gets a genuine estimate, never the exact roster. */
function estimateStrength(actual: number): number {
  return Math.max(
    STRENGTH_ESTIMATE_GRANULARITY,
    Math.round(actual / STRENGTH_ESTIMATE_GRANULARITY) * STRENGTH_ESTIMATE_GRANULARITY,
  );
}

function updateContacts(state: GameState, playerId: PlayerId): void {
  const opponent = opponentOf(playerId);
  const contacts = state.contacts[playerId];
  const units = state.units;

  for (const group of activeGroups(state, opponent)) {
    let seenX = 0;
    let seenY = 0;
    let seenCount = 0;
    const categories = new Set<UnitCategory>();

    for (let position = 0; position < group.members.length; position += VISION_STRIDE) {
      const index = group.members[position];
      if (index === undefined || units.alive[index] !== 1) continue;
      const x = units.x[index] ?? 0;
      const y = units.y[index] ?? 0;
      if (!isVisibleTo(state, playerId, x, y)) continue;
      seenX += x;
      seenY += y;
      seenCount += 1;
      categories.add(units.categoryOf(index));
    }

    if (seenCount > 0) {
      const position: Vector2D = { x: seenX / seenCount, y: seenY / seenCount };
      contacts.set(group.id, {
        groupId: group.id,
        name: group.name,
        estimatedStrength: estimateStrength(group.members.length),
        composition: [...categories].sort(),
        lastPosition: position,
        lastSeenTick: state.currentTick,
        lastSeenZone: zoneAt(position.x, position.y),
        visibleNow: true,
      });
      continue;
    }

    const remembered = contacts.get(group.id);
    if (remembered !== undefined) {
      remembered.visibleNow = false;
      if (state.currentTick - remembered.lastSeenTick > CONTACT_MEMORY_TICKS) {
        contacts.delete(group.id);
      }
    }
  }

  // Forget groups that no longer exist at all.
  for (const groupId of [...contacts.keys()].sort()) {
    const index = state.groupIndexById.get(groupId);
    const group = index === undefined ? undefined : state.groups[index];
    if (group === undefined || group.members.length === 0) contacts.delete(groupId);
  }
}

export function advanceVisibility(state: GameState): void {
  if (state.currentTick % VISIBILITY_INTERVAL !== 0) return;
  for (const playerId of PLAYER_IDS) {
    recomputeFog(state, playerId);
    updateContacts(state, playerId);
  }
}

/** Reveals starting positions so the opening is not a blank screen. */
export function seedInitialVisibility(state: GameState): void {
  for (const playerId of PLAYER_IDS) recomputeFog(state, playerId);
  for (const playerId of PLAYER_IDS) updateContacts(state, playerId);
}
