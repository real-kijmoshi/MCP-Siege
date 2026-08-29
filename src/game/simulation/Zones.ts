import { MAP_HEIGHT, MAP_WIDTH } from '../config/battle';
import { ZONE_IDS, type Front, type Vector2D, type ZoneId } from '../types/domain';

/**
 * The battlefield's semantic geography.
 *
 * WebMCP addresses locations by these names rather than by pixels, so the
 * Marshal reasons about "the central bridge" instead of coordinates. The river
 * splits the map; it is impassable except at the three crossings, which is what
 * makes the terrain tactically binding.
 */

export type TerrainKind = 'open' | 'forest' | 'hill' | 'river' | 'village' | 'crossing';

export interface ZoneDefinition {
  id: ZoneId;
  name: string;
  center: Vector2D;
  radius: number;
  front: Front;
  terrain: TerrainKind;
  /** True for the three points where the river can be crossed. */
  crossing: boolean;
  description: string;
}

const ZONE_LIST: ZoneDefinition[] = [
  {
    id: 'player_base',
    name: 'Player Base',
    center: { x: 4000, y: 4550 },
    radius: 760,
    front: 'rear',
    terrain: 'open',
    crossing: false,
    description: 'Staging ground and muster point. Reinforcements arrive here.',
  },
  {
    id: 'west_forest',
    name: 'West Forest',
    center: { x: 1250, y: 3250 },
    radius: 660,
    front: 'west',
    terrain: 'forest',
    crossing: false,
    description: 'Dense woodland. Conceals movement toward the western ford.',
  },
  {
    id: 'west_crossing',
    name: 'West Crossing',
    center: { x: 1500, y: 2500 },
    radius: 380,
    front: 'west',
    terrain: 'crossing',
    crossing: true,
    description: 'A shallow ford. Narrow, and the only western route north.',
  },
  {
    id: 'village',
    name: 'Village',
    center: { x: 2750, y: 3550 },
    radius: 430,
    front: 'west',
    terrain: 'village',
    crossing: false,
    description: 'Abandoned village. Buildings break up cavalry charges.',
  },
  {
    id: 'central_field',
    name: 'Central Field',
    center: { x: 4000, y: 3200 },
    radius: 820,
    front: 'center',
    terrain: 'open',
    crossing: false,
    description: 'Open ground south of the bridge. The main line forms here.',
  },
  {
    id: 'central_bridge',
    name: 'Central Bridge',
    center: { x: 4000, y: 2500 },
    radius: 340,
    front: 'center',
    terrain: 'crossing',
    crossing: true,
    description: 'The main stone bridge. The decisive point of the battle.',
  },
  {
    id: 'central_hill',
    name: 'Central Hill',
    center: { x: 4950, y: 3050 },
    radius: 470,
    front: 'center',
    terrain: 'hill',
    crossing: false,
    description: 'High ground overlooking the bridge. Ideal for archers and siege.',
  },
  {
    id: 'east_field',
    name: 'East Field',
    center: { x: 6600, y: 3350 },
    radius: 780,
    front: 'east',
    terrain: 'open',
    crossing: false,
    description: 'Wide open ground. Excellent cavalry country, hard to hold.',
  },
  {
    id: 'east_crossing',
    name: 'East Crossing',
    center: { x: 6600, y: 2500 },
    radius: 360,
    front: 'east',
    terrain: 'crossing',
    crossing: true,
    description: 'A smaller bridge on the eastern flank.',
  },
  {
    id: 'east_forest',
    name: 'East Forest',
    center: { x: 7450, y: 3150 },
    radius: 570,
    front: 'east',
    terrain: 'forest',
    crossing: false,
    description: 'Woodland anchoring the eastern flank.',
  },
  {
    id: 'northern_ridge',
    name: 'Northern Ridge',
    center: { x: 2500, y: 1500 },
    radius: 720,
    front: 'west',
    terrain: 'hill',
    crossing: false,
    description: 'Enemy-held high ground north of the ford.',
  },
  {
    id: 'enemy_outer_defense',
    name: 'Enemy Outer Defense',
    center: { x: 4200, y: 1500 },
    radius: 860,
    front: 'center',
    terrain: 'open',
    crossing: false,
    description: 'Prepared enemy positions covering the northern bridgehead.',
  },
  {
    id: 'enemy_base',
    name: 'Enemy Base',
    center: { x: 4000, y: 620 },
    radius: 820,
    front: 'rear',
    terrain: 'open',
    crossing: false,
    description: 'Fortified enemy command position.',
  },
];

export const ZONES: Record<ZoneId, ZoneDefinition> = Object.fromEntries(
  ZONE_LIST.map((zone) => [zone.id, zone]),
) as Record<ZoneId, ZoneDefinition>;

export const ORDERED_ZONES: readonly ZoneDefinition[] = ZONE_IDS.map((id) => ZONES[id]);

/* -------------------------------------------------------------------- river */

/** The river meanders gently so the map does not read as a drawn straight line. */
export function riverCenterY(x: number): number {
  return 2500 + Math.sin(x / 1350) * 135 + Math.sin(x / 480) * 32;
}

export const RIVER_HALF_WIDTH = 135;

/** Crossings are ordered west to east; passage is allowed only within these. */
export const CROSSINGS: readonly ZoneDefinition[] = ZONE_LIST.filter((zone) => zone.crossing);

export function isInRiver(x: number, y: number): boolean {
  return Math.abs(y - riverCenterY(x)) < RIVER_HALF_WIDTH;
}

/** True where the river may actually be crossed. */
export function isOnCrossing(x: number, y: number): boolean {
  for (const crossing of CROSSINGS) {
    const width = crossing.radius * 0.62;
    if (Math.abs(x - crossing.center.x) < width) return true;
  }
  return false;
}

/** The river is passable only on a crossing. */
export function isPassable(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x > MAP_WIDTH || y > MAP_HEIGHT) return false;
  if (!isInRiver(x, y)) return true;
  return isOnCrossing(x, y);
}

export function isNorthOfRiver(y: number, x: number): boolean {
  return y < riverCenterY(x);
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
  let bestId: ZoneId = 'central_field';
  let bestScore = Number.POSITIVE_INFINITY;

  for (const zone of ORDERED_ZONES) {
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
  if (isInRiver(x, y)) return isOnCrossing(x, y) ? 'crossing' : 'river';
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
 * Adjacency for group-level pathfinding. Every edge that changes bank passes
 * through a crossing, so ordering a group north forces it onto a bridge or ford.
 */
export const ZONE_EDGES: ReadonlyArray<readonly [ZoneId, ZoneId]> = [
  ['player_base', 'central_field'],
  ['player_base', 'village'],
  ['player_base', 'east_field'],
  ['village', 'west_forest'],
  ['village', 'central_field'],
  ['west_forest', 'west_crossing'],
  ['central_field', 'central_bridge'],
  ['central_field', 'central_hill'],
  ['central_hill', 'east_field'],
  ['east_field', 'east_crossing'],
  ['east_field', 'east_forest'],
  ['east_forest', 'east_crossing'],
  // River crossings: the only edges that change bank.
  ['west_crossing', 'northern_ridge'],
  ['central_bridge', 'enemy_outer_defense'],
  ['east_crossing', 'enemy_outer_defense'],
  // Northern bank.
  ['northern_ridge', 'enemy_outer_defense'],
  ['northern_ridge', 'enemy_base'],
  ['enemy_outer_defense', 'enemy_base'],
];

export const ZONE_NEIGHBOURS: Record<ZoneId, ZoneId[]> = (() => {
  const map = Object.fromEntries(ZONE_IDS.map((id) => [id, [] as ZoneId[]])) as Record<
    ZoneId,
    ZoneId[]
  >;
  for (const [from, to] of ZONE_EDGES) {
    map[from].push(to);
    map[to].push(from);
  }
  // Sorted so graph traversal order never depends on declaration order.
  for (const id of ZONE_IDS) map[id].sort();
  return map;
})();
