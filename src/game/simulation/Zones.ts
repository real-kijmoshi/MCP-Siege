import { MAP_HEIGHT, MAP_WIDTH } from '../config/battle';
import {
  BATTLE_MAPS,
  BATTLE_MAP_IDS,
  ZONE_CATALOGUE,
  barrierCenterY,
  type BattleMapDefinition,
  type BattleMapId,
  type TerrainKind,
  type ZoneDefinition,
} from '../config/maps';
import type { PlayerId, Vector2D, ZoneId } from '../types/domain';

/**
 * The battlefield's semantic geography.
 *
 * WebMCP addresses locations by these names rather than by pixels, so the
 * Marshal reasons about "the central bridge" instead of coordinates. Which
 * ground those names describe depends on the map being fought over, which is
 * why every geographic answer here is taken from the *active* map.
 *
 * The active map is a cache of `GameState.mapId`, not a second source of truth.
 * `SimulationEngine` re-establishes it from its own state before every tick and
 * every dispatch, and `GameQueries` does the same before every read, so two
 * engines on two different maps in one process cannot read each other's ground.
 * Nothing here is ever written by a system.
 */

export type { TerrainKind, ZoneDefinition } from '../config/maps';

/* -------------------------------------------------------------- map runtime */

interface MapRuntime {
  map: BattleMapDefinition;
  zoneIds: readonly ZoneId[];
  crossings: readonly ZoneDefinition[];
  neighbours: Record<ZoneId, ZoneId[]>;
  roadEdges: Set<string>;
}

function edgeKey(first: ZoneId, second: ZoneId): string {
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function buildRuntime(map: BattleMapDefinition): MapRuntime {
  const zoneIds = map.zones.map((zone) => zone.id);
  const neighbours = Object.fromEntries(zoneIds.map((id) => [id, [] as ZoneId[]])) as Record<
    ZoneId,
    ZoneId[]
  >;

  for (const [from, to] of map.edges) {
    const forward = neighbours[from];
    const backward = neighbours[to];
    if (forward === undefined || backward === undefined) {
      throw new Error(`Map "${map.id}" has an edge to a zone it does not contain.`);
    }
    forward.push(to);
    backward.push(from);
  }
  // Sorted so graph traversal order never depends on declaration order.
  for (const id of zoneIds) neighbours[id].sort();

  const roadEdges = new Set<string>();
  for (const road of map.roads) {
    for (let index = 1; index < road.length; index += 1) {
      const previous = road[index - 1];
      const current = road[index];
      if (previous !== undefined && current !== undefined) roadEdges.add(edgeKey(previous, current));
    }
  }

  return {
    map,
    zoneIds,
    crossings: map.zones.filter((zone) => zone.crossing),
    neighbours,
    roadEdges,
  };
}

const RUNTIMES: Record<BattleMapId, MapRuntime> = Object.fromEntries(
  BATTLE_MAP_IDS.map((id) => [id, buildRuntime(BATTLE_MAPS[id])]),
) as Record<BattleMapId, MapRuntime>;

let runtime: MapRuntime = RUNTIMES.river_vale;

/** Points every geographic answer at one map. Cheap, and safe to call per tick. */
export function useBattleMap(id: BattleMapId): void {
  if (runtime.map.id !== id) runtime = RUNTIMES[id];
}

export function activeBattleMap(): BattleMapDefinition {
  return runtime.map;
}

export function activeBattleMapId(): BattleMapId {
  return runtime.map.id;
}

/* ---------------------------------------------------------------- lookups */

/**
 * Every zone on every map, by id.
 *
 * Naming a location is map-independent — a report can spell out "Cinder Gap"
 * without the reader first knowing which battle it came from — so this stays a
 * flat catalogue. Anything that asks about *ground* goes through the active map.
 */
export const ZONES = ZONE_CATALOGUE;

/** The zones of the active map, in authored order. */
export function activeZones(): readonly ZoneDefinition[] {
  return runtime.map.zones;
}

export function activeZoneIds(): readonly ZoneId[] {
  return runtime.zoneIds;
}

export function isActiveZone(id: ZoneId): boolean {
  return runtime.neighbours[id] !== undefined;
}

/** Where a side musters, routs to, and receives reinforcements. */
export function homeZoneOf(playerId: PlayerId): ZoneDefinition {
  const id = playerId === 'player' ? runtime.map.playerHomeZone : runtime.map.enemyHomeZone;
  return ZONES[id];
}

/* ---------------------------------------------------------------- barrier */

/** The centreline of the dividing feature, or the map's midline if it has none. */
export function barrierCenterAt(x: number): number {
  const barrier = runtime.map.barrier;
  return barrier === undefined ? MAP_HEIGHT / 2 : barrierCenterY(barrier, x);
}

export function barrierHalfWidth(): number {
  return runtime.map.barrier?.halfWidth ?? 0;
}

/** Crossings, in authored order (west to east). */
export function activeCrossings(): readonly ZoneDefinition[] {
  return runtime.crossings;
}

export function isInBarrier(x: number, y: number): boolean {
  const barrier = runtime.map.barrier;
  if (barrier === undefined) return false;
  return Math.abs(y - barrierCenterY(barrier, x)) < barrier.halfWidth;
}

/** True where the barrier may actually be passed. */
export function isOnCrossing(x: number, y: number): boolean {
  for (const crossing of runtime.crossings) {
    const width = crossing.radius * 0.62;
    if (Math.abs(x - crossing.center.x) < width) return true;
  }
  return false;
}

function isInMere(x: number, y: number): boolean {
  for (const mere of runtime.map.meres) {
    const dx = x - mere.center.x;
    const dy = y - mere.center.y;
    if (dx * dx + dy * dy < mere.radius * mere.radius) return true;
  }
  return false;
}

/** The barrier is passable only on a crossing; standing water never is. */
export function isPassable(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x > MAP_WIDTH || y > MAP_HEIGHT) return false;
  if (isInMere(x, y)) return false;
  if (!isInBarrier(x, y)) return true;
  return isOnCrossing(x, y);
}

/** True on the enemy's side of the dividing feature. */
export function isBeyondBarrier(y: number, x: number): boolean {
  return y < barrierCenterAt(x);
}

/* ------------------------------------------------------------------- lookup */

export function distanceSquared(a: Vector2D, b: Vector2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * The zone a position belongs to. Falls back to the nearest zone centre so every
 * point on the map has a name the Marshal can refer to.
 */
export function zoneAt(x: number, y: number): ZoneId {
  let bestId: ZoneId = runtime.map.zones[0]?.id ?? runtime.map.playerHomeZone;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const zone of runtime.map.zones) {
    const dx = x - zone.center.x;
    const dy = y - zone.center.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Distance is measured relative to each zone's own radius, so the tightest
    // zone containing the point wins. Scoring by raw distance would let a big
    // zone swallow a small one sitting inside it, and report a regiment
    // standing on the bridge as being somewhere out in the central field.
    const score =
      distance <= zone.radius ? distance / zone.radius : Number.MAX_SAFE_INTEGER + distance;

    if (score < bestScore) {
      bestScore = score;
      bestId = zone.id;
    }
  }
  return bestId;
}

export function terrainAt(x: number, y: number): TerrainKind {
  if (isInMere(x, y)) return 'river';
  if (isInBarrier(x, y)) {
    return isOnCrossing(x, y) ? 'crossing' : (runtime.map.barrier?.kind ?? 'river');
  }
  const zone = ZONES[zoneAt(x, y)];
  const dx = x - zone.center.x;
  const dy = y - zone.center.y;
  return dx * dx + dy * dy <= zone.radius * zone.radius ? zone.terrain : 'open';
}

/** Terrain that a defender benefits from holding. */
export function isDefensiveTerrain(x: number, y: number): boolean {
  const terrain = terrainAt(x, y);
  return terrain === 'forest' || terrain === 'hill' || terrain === 'village';
}

/* --------------------------------------------------------- navigation graph */

/**
 * Adjacency for group-level pathfinding. On a divided map every edge that
 * changes bank passes through a crossing, so ordering a group across forces it
 * onto a bridge, a ford or a gap.
 */
export function neighboursOf(zoneId: ZoneId): readonly ZoneId[] {
  return runtime.neighbours[zoneId] ?? [];
}

/** True when two adjacent zones are joined by an authored marching road. */
export function isRoadConnection(first: ZoneId, second: ZoneId): boolean {
  return runtime.roadEdges.has(edgeKey(first, second));
}
