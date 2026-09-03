/**
 * Shared vocabulary for the battle simulation.
 *
 * Everything the player and the external Marshal can name lives here. Individual
 * soldiers are deliberately absent: they exist only as indices into the typed
 * arrays of `UnitPool` and are never addressable across the WebMCP boundary.
 */

export interface Vector2D {
  x: number;
  y: number;
}

/** Faction slot used inside the typed arrays. */
export const FACTION_PLAYER = 0;
export const FACTION_ENEMY = 1;

export type PlayerId = 'player' | 'enemy';

export const PLAYER_IDS = ['player', 'enemy'] as const;

export function factionOf(playerId: PlayerId): number {
  return playerId === 'player' ? FACTION_PLAYER : FACTION_ENEMY;
}

export function playerIdOf(faction: number): PlayerId {
  return faction === FACTION_PLAYER ? 'player' : 'enemy';
}

export function opponentOf(playerId: PlayerId): PlayerId {
  return playerId === 'player' ? 'enemy' : 'player';
}

/* ------------------------------------------------------------------ units */

export const UNIT_CATEGORIES = [
  'infantry',
  'spearman',
  'archer',
  'handgunner',
  'cavalry',
  'heavy_infantry',
  'siege',
  'cannon',
  'scout',
  'surgeon',
] as const;
export type UnitCategory = (typeof UNIT_CATEGORIES)[number];

/** Numeric encoding stored in `UnitPool.category`. */
export function categoryIndex(category: UnitCategory): number {
  return UNIT_CATEGORIES.indexOf(category);
}

export function categoryAt(index: number): UnitCategory {
  return UNIT_CATEGORIES[index] ?? 'infantry';
}

export function isUnitCategory(value: string): value is UnitCategory {
  return (UNIT_CATEGORIES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------- formations */

export const FORMATIONS = [
  'line',
  'column',
  'block',
  'wedge',
  'double_line',
  'loose',
  'square',
] as const;
export type Formation = (typeof FORMATIONS)[number];

export const STANCES = ['aggressive', 'defensive', 'hold_ground'] as const;
export type Stance = (typeof STANCES)[number];

/**
 * Named regiment positions inside a coordinated battlefield deployment.
 *
 * These are deliberately semantic rather than coordinates. WebMCP may arrange
 * regiments into a custom line, screen or reserve around named ground, but it
 * still never receives a pixel-level movement surface or soldier identities.
 */
export const TACTICAL_SLOTS = [
  'front_left',
  'front_center',
  'front_right',
  'far_left',
  'left',
  'center',
  'right',
  'far_right',
  'rear_left',
  'rear_center',
  'rear_right',
  'reserve_left',
  'reserve_center',
  'reserve_right',
] as const;
export type TacticalSlot = (typeof TACTICAL_SLOTS)[number];

/* ----------------------------------------------------------------- morale */

export const MORALE_STATES = ['confident', 'stable', 'shaken', 'breaking', 'routing'] as const;
export type MoraleState = (typeof MORALE_STATES)[number];

/* ------------------------------------------------------------------ zones */

/**
 * Every named location on every battlefield.
 *
 * The list is the union across all maps, because `ZoneId` must be a static
 * literal union for the WebMCP schemas and the command contracts to be typed at
 * all. A single battle only ever uses one map's zones: `config/maps.ts` claims
 * each id for exactly one map, and the tool surface narrows its enum to the map
 * actually being fought over, so the Marshal is never offered a location that
 * is not on the field in front of it.
 */
export const ZONE_IDS = [
  // River Vale
  'player_base',
  'west_forest',
  'west_crossing',
  'central_field',
  'central_bridge',
  'central_hill',
  'village',
  'east_field',
  'east_crossing',
  'east_forest',
  'northern_ridge',
  'enemy_outer_defense',
  'enemy_base',
  // Ashfall Pass
  'crown_camp',
  'south_orchard',
  'smoke_road',
  'slag_flats',
  'broken_scree',
  'east_scarp',
  'cinder_gap',
  'ashfall_gate',
  'upper_terrace',
  'obsidian_wood',
  'emberhold',
  'smelters_hill',
  'ash_citadel',
  // Goldmere
  'harvest_camp',
  'millbrook',
  'south_downs',
  'hollow_wood',
  'west_pasture',
  'goldmere_town',
  'east_pasture',
  'long_barrow',
  'crowsfoot_wood',
  'beacon_hill',
  'hartfell',
  'stone_row',
  'ashen_camp',
  // Sunken Causeway
  'tidewatch',
  'drowned_wood',
  'causeway_approach',
  'oyster_town',
  'gull_hill',
  'reed_flats',
  'long_causeway',
  'salt_ford',
  'north_strand',
  'black_pines',
  'beacon_tower',
  'herring_quay',
  'ashen_anchorage',
] as const;
export type ZoneId = (typeof ZONE_IDS)[number];

export function isZoneId(value: string): value is ZoneId {
  return (ZONE_IDS as readonly string[]).includes(value);
}

/** Coarse front assignment used by overview and front-status projections. */
export const FRONTS = ['west', 'center', 'east', 'rear'] as const;
export type Front = (typeof FRONTS)[number];

/* ----------------------------------------------------------------- orders */

export const ORDER_KINDS = [
  'idle',
  'move',
  'attack_zone',
  'attack_group',
  'defend_zone',
  'hold',
  'retreat',
  'scout',
  'support',
] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

export interface ArmyOrder {
  kind: OrderKind;
  /** Semantic destination. Absent for `idle` and `hold`. */
  targetZone?: ZoneId;
  /** Present for `attack_group` and `support`. */
  targetGroupId?: string;
  /** Resolved world destination the group navigates toward. */
  destination?: Vector2D;
  issuedAtTick: number;
}

/* ----------------------------------------------------------------- groups */

export interface ArmyGroup {
  id: string;
  name: string;
  ownerId: PlayerId;
  /** Live unit indices into `UnitPool`. Kept sorted for deterministic iteration. */
  members: number[];
  formation: Formation;
  stance: Stance;
  order: ArmyOrder;
  /** Formation origin in world space. */
  anchor: Vector2D;
  /** Radians. Formation slots are generated around this heading. */
  facing: number;
  morale: number;
  moraleState: MoraleState;
  /** Group-level waypoints produced by `Navigation`. Consumed front to back. */
  path: Vector2D[];
  /**
   * Consecutive ticks the anchor has failed to close on its next waypoint.
   *
   * A march is planned once, but a marching body is pushed about by the
   * regiments around it, so the line it was given and the line it is actually
   * walking drift apart. This is how `Movement` notices that a group is no
   * longer getting anywhere and asks `Navigation` for a fresh route.
   */
  stallTicks: number;
  /**
   * Tick of the last automatic re-route, so a regiment that genuinely cannot be
   * routed re-searches occasionally rather than every tick.
   */
  lastReplanTick: number;
  /** Strength at spawn, used for percentage readouts. */
  initialStrength: number;
  homeZone: ZoneId;
  /** Tick of the most recent casualty. Drives "under attack" reporting. */
  lastCasualtyTick: number;
  /** Decaying casualty accumulator that feeds the morale system. */
  recentCasualties: number;
  /** Set while a group is retreating under its own morale, not by order. */
  routing: boolean;
  /**
   * Share of the group's men in contact with an enemy last tick, 0..1.
   * Written by `Combat`; read by `Movement` to decide whether the formation is
   * pinned and can no longer simply march past what is in front of it.
   */
  engagement: number;
  /**
   * How far round the formation the attack has come, 0 for a plain frontal
   * fight and 1 for a body of men completely ringed. Written by `Combat` from
   * the arcs blows actually arrived on, and read by both damage and morale.
   */
  encirclement: number;
  /**
   * How hard the men are packed against one another, 0 at a formation's own
   * spacing and 1 when they are crushed together. Written by `Combat` from the
   * density of *friendly* troops around each man, so several regiments forced
   * through one gap register it as sharply as they deserve to. Read by damage
   * and morale: a crushed body of men fights badly and is a gift to archers.
   */
  crowding: number;
  /**
   * How spent the regiment is, 0 fresh and 1 exhausted. Written by `Fatigue`
   * and read by damage, morale and the pressure solver. This is the term that
   * makes a reserve worth holding rather than committing everything at once.
   */
  fatigue: number;
  /**
   * How well the regiment is being tended by a field hospital, 0 for men left
   * to their own surgeons and 1 for a formation small enough to be wholly cared
   * for. Written by `FieldSupport` from the hospitals within reach; read by
   * `Fatigue`, `Morale` and the healing pass itself.
   *
   * This is the term that makes withdrawing a battered regiment a move rather
   * than an admission. Nothing about it works in contact: men cannot be tended
   * while they are still fighting.
   */
  succour: number;
  /**
   * How badly the formation has just been shaken by a charge, 0 for men nobody
   * has ridden into and 1 for a body that has taken a full-weight impact.
   * Written by `Combat` from the charges actually delivered against it and read
   * by `Morale`, where it decays over a few seconds.
   *
   * This is what makes horse decisive rather than merely expensive. A charge
   * kills fewer men than the melee that follows it; what it does is break the
   * line it lands on, and before this term existed the simulation had no way of
   * saying so.
   */
  shock: number;
  /**
   * Share of this regiment's attempted shots that were obstructed by its own
   * army, 0 for a clear field of fire and 1 for a lane completely masked.
   * Written by `Combat`, smoothed, and reported to the roster and the Marshal —
   * it is otherwise entirely invisible, and a battery that is shooting at
   * nothing looks exactly like one that is winning the battle.
   */
  blockedFire: number;
}

/* ------------------------------------------------------------- conditions */

export const CONDITION_KINDS = [
  'immediate',
  'after_step',
  'morale_below',
  'strength_below',
  'enemy_enters_zone',
  'friendly_zone_lost',
  'enemy_unit_type_visible',
  'timer_elapsed',
  'king_besieged',
] as const;
export type ConditionKind = (typeof CONDITION_KINDS)[number];

/**
 * A closed vocabulary of triggers. Deliberately not arbitrary code: the Marshal
 * composes conditions from these shapes only (brief section 17).
 */
export type PlanCondition =
  | { kind: 'immediate' }
  | { kind: 'after_step'; stepId: string }
  | { kind: 'morale_below'; groupId: string; value: number }
  | { kind: 'strength_below'; groupId: string; percent: number }
  | { kind: 'enemy_enters_zone'; zoneId: ZoneId }
  | { kind: 'friendly_zone_lost'; zoneId: ZoneId }
  | { kind: 'enemy_unit_type_visible'; category: UnitCategory; zoneId?: ZoneId }
  | { kind: 'timer_elapsed'; seconds: number }
  | { kind: 'king_besieged' };

/* ------------------------------------------------------------------ plans */

export const PLAN_ACTIONS = [
  'move',
  'attack_zone',
  'attack_group',
  'defend_zone',
  'hold',
  'retreat',
  'change_formation',
  'support',
] as const;
export type PlanAction = (typeof PLAN_ACTIONS)[number];

export interface PlanStep {
  id: string;
  index: number;
  groupId: string;
  action: PlanAction;
  targetZone?: ZoneId;
  targetGroupId?: string;
  formation?: Formation;
  stance?: Stance;
  startCondition: PlanCondition;
  note: string;
}

export type PlanStatus = 'draft' | 'executing' | 'complete' | 'cancelled';

export interface BattlePlan {
  id: string;
  name: string;
  status: PlanStatus;
  createdAtTick: number;
  steps: PlanStep[];
}

/** A step promoted to a live trigger by `execute_plan`, or a standing order. */
export interface PendingConditionalOrder {
  id: string;
  planId?: string;
  stepId?: string;
  groupId: string;
  action: PlanAction;
  targetZone?: ZoneId;
  targetGroupId?: string;
  formation?: Formation;
  stance?: Stance;
  condition: PlanCondition;
  createdAtTick: number;
  note: string;
}

/* -------------------------------------------------------------- objective */

/** What one side has actually observed of the opposing king. */
export interface KingSighting {
  position: Vector2D;
  zoneId: ZoneId;
  tick: number;
}

/**
 * A sovereign.
 *
 * He is an objective, not a hero: he has no abilities, deals no damage and is
 * never addressable as a unit. He rides with his Royal Guard and is taken by
 * holding the ground around him, which is the only way the battle is won
 * outright.
 */
export interface KingState {
  ownerId: PlayerId;
  name: string;
  position: Vector2D;
  /** The regiment he rides with. While it lives, he moves where it moves. */
  guardGroupId: string;
  guardStrength: number;
  /** 0-100. Filled while the enemy holds the ground around him. */
  captureProgress: number;
  captured: boolean;
  /** True while an enemy force dominates the capture ring. */
  besieged: boolean;
  /** Strength inside the ring at the last evaluation. */
  defenders: number;
  attackers: number;
  /** What the *opposing* side has seen of him. Absent until he is sighted. */
  lastSightingByOpponent?: KingSighting;
}

export type BattleOutcome = 'ongoing' | 'player_victory' | 'enemy_victory';

export interface ObjectiveState {
  kings: Record<PlayerId, KingState>;
  /** Opening numbers per side, so a collapse can be measured against them. */
  initialStrength: Record<PlayerId, number>;
  outcome: BattleOutcome;
  outcomeReason: string;
  decidedAtTick: number;
}

/* ----------------------------------------------------------- intelligence */

/** What one side remembers about an enemy group it has seen. */
export interface EnemyContact {
  groupId: string;
  name: string;
  /** Rounded so exact truth never leaks across the fog boundary. */
  estimatedStrength: number;
  composition: UnitCategory[];
  lastPosition: Vector2D;
  lastSeenTick: number;
  lastSeenZone: ZoneId;
  visibleNow: boolean;
}

/* ---------------------------------------------------------------- effects */

/**
 * A sampled attack, kept only so the renderer can flash something. Purely
 * cosmetic and bounded; nothing in the simulation reads it back.
 */
export interface CombatEvent {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  kind: 'melee' | 'arrow' | 'siege';
  tick: number;
}

/* ----------------------------------------------------------------- alerts */

export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export interface BattleAlert {
  id: string;
  /** Stable key used to dedupe repeats of the same situation. */
  key: string;
  severity: AlertSeverity;
  message: string;
  tick: number;
  zoneId?: ZoneId;
  groupId?: string;
}
