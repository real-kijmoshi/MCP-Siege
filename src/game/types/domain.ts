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
  'cavalry',
  'heavy_infantry',
  'siege',
  'scout',
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

/* ----------------------------------------------------------------- morale */

export const MORALE_STATES = ['confident', 'stable', 'shaken', 'breaking', 'routing'] as const;
export type MoraleState = (typeof MORALE_STATES)[number];

/* ------------------------------------------------------------------ zones */

export const ZONE_IDS = [
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
  /** Strength at spawn, used for percentage readouts. */
  initialStrength: number;
  homeZone: ZoneId;
  /** Tick of the most recent casualty. Drives "under attack" reporting. */
  lastCasualtyTick: number;
  /** Decaying casualty accumulator that feeds the morale system. */
  recentCasualties: number;
  /** Set while a group is retreating under its own morale, not by order. */
  routing: boolean;
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
