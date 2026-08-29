/**
 * Tuning constants for the battle simulation.
 *
 * Everything that shapes tactical decisions is centralised here so balance can be
 * adjusted without touching systems. All rates are expressed per tick; the
 * simulation never reads wall-clock time.
 */

import type { Formation, UnitCategory } from '../types/domain';

export const TICKS_PER_SECOND = 20;
export const FIXED_STEP_MS = 1000 / TICKS_PER_SECOND;

/** A deliberately large battlefield: several screens wide at default zoom. */
export const MAP_WIDTH = 8000;
export const MAP_HEIGHT = 5000;

/** Capacity of the unit pool. Sized above the scenario so reinforcements fit. */
export const UNIT_CAPACITY = 10_000;

/* --------------------------------------------------------------- unit stats */

export interface UnitStats {
  label: string;
  maxHitPoints: number;
  attack: number;
  /** World units. Melee ranges are short but non-zero so ranks can engage. */
  range: number;
  /** Ticks between attacks. */
  cooldownTicks: number;
  /** World units per tick. */
  speed: number;
  vision: number;
  /** Splash radius in world units. Only siege has one. */
  splashRadius: number;
  /** Contribution to a group's reported "strength" figure. */
  strengthValue: number;
}

function perSecond(worldUnitsPerSecond: number): number {
  return worldUnitsPerSecond / TICKS_PER_SECOND;
}

export const UNIT_STATS: Record<UnitCategory, UnitStats> = {
  infantry: {
    label: 'Infantry',
    maxHitPoints: 100,
    attack: 5.5,
    range: 14,
    cooldownTicks: 12,
    speed: perSecond(34),
    vision: 300,
    splashRadius: 0,
    strengthValue: 1,
  },
  spearman: {
    label: 'Spearmen',
    maxHitPoints: 95,
    attack: 5,
    range: 22,
    cooldownTicks: 14,
    speed: perSecond(32),
    vision: 300,
    splashRadius: 0,
    strengthValue: 1,
  },
  archer: {
    label: 'Archers',
    maxHitPoints: 65,
    attack: 4.2,
    range: 155,
    cooldownTicks: 20,
    speed: perSecond(33),
    vision: 430,
    splashRadius: 0,
    strengthValue: 1,
  },
  cavalry: {
    label: 'Cavalry',
    maxHitPoints: 130,
    attack: 8.5,
    range: 16,
    cooldownTicks: 14,
    speed: perSecond(74),
    vision: 380,
    splashRadius: 0,
    strengthValue: 1.6,
  },
  heavy_infantry: {
    label: 'Heavy Infantry',
    maxHitPoints: 180,
    attack: 6.6,
    range: 14,
    cooldownTicks: 16,
    speed: perSecond(24),
    vision: 280,
    splashRadius: 0,
    strengthValue: 1.8,
  },
  siege: {
    label: 'Siege',
    maxHitPoints: 120,
    attack: 30,
    range: 430,
    cooldownTicks: 90,
    speed: perSecond(14),
    vision: 360,
    splashRadius: 52,
    strengthValue: 6,
  },
  scout: {
    label: 'Scouts',
    maxHitPoints: 55,
    attack: 2,
    range: 12,
    cooldownTicks: 20,
    speed: perSecond(88),
    vision: 720,
    splashRadius: 0,
    strengthValue: 0.4,
  },
};

/**
 * Damage multiplier applied as COUNTER_MATRIX[attacker][defender].
 * Only the tactically meaningful relationships deviate from 1.
 */
export const COUNTER_MATRIX: Record<UnitCategory, Partial<Record<UnitCategory, number>>> = {
  infantry: { archer: 1.4, siege: 1.5, scout: 1.6, heavy_infantry: 0.7 },
  spearman: { cavalry: 2.4, archer: 1.2, scout: 1.4, heavy_infantry: 0.8 },
  archer: { infantry: 1.0, heavy_infantry: 0.55, cavalry: 0.8, siege: 1.3, scout: 1.2 },
  cavalry: { archer: 2.6, siege: 2.2, scout: 2.0, spearman: 0.45, heavy_infantry: 0.75 },
  heavy_infantry: { infantry: 1.3, spearman: 1.2, archer: 1.5, cavalry: 0.9 },
  siege: { infantry: 1.2, heavy_infantry: 1.2, spearman: 1.2, archer: 1.1, cavalry: 0.6 },
  scout: {},
};

export function counterMultiplier(attacker: UnitCategory, defender: UnitCategory): number {
  return COUNTER_MATRIX[attacker][defender] ?? 1;
}

/* -------------------------------------------------------- formation profile */

export interface FormationProfile {
  label: string;
  /** Width of the formation relative to a square block of the same size. */
  frontage: number;
  /** Spacing between slots, world units. */
  spacing: number;
  meleeModifier: number;
  /** Higher means more damage taken from arrows. */
  rangedVulnerability: number;
  /** Higher means better resistance to a cavalry charge. */
  antiCavalry: number;
  speedModifier: number;
  /** Higher means siege splash lands on more men. */
  splashVulnerability: number;
  description: string;
}

export const FORMATION_PROFILES: Record<Formation, FormationProfile> = {
  line: {
    label: 'Line',
    frontage: 1.9,
    spacing: 15,
    meleeModifier: 1,
    rangedVulnerability: 1,
    antiCavalry: 1,
    speedModifier: 0.9,
    splashVulnerability: 1,
    description: 'Wide frontage. Brings the most men into contact.',
  },
  column: {
    label: 'Column',
    frontage: 0.35,
    spacing: 15,
    meleeModifier: 0.8,
    rangedVulnerability: 0.9,
    antiCavalry: 0.8,
    speedModifier: 1.25,
    splashVulnerability: 1.2,
    description: 'Narrow and fast. Best for crossings and forest tracks.',
  },
  block: {
    label: 'Block',
    frontage: 1,
    spacing: 14,
    meleeModifier: 1.05,
    rangedVulnerability: 1.1,
    antiCavalry: 1,
    speedModifier: 1,
    splashVulnerability: 1.25,
    description: 'Stable general-purpose formation.',
  },
  wedge: {
    label: 'Wedge',
    frontage: 0.85,
    spacing: 16,
    meleeModifier: 1.35,
    rangedVulnerability: 1,
    antiCavalry: 0.9,
    speedModifier: 1.1,
    splashVulnerability: 1.1,
    description: 'Offensive shock formation. Strong charge, weak flanks.',
  },
  double_line: {
    label: 'Double Line',
    frontage: 1.45,
    spacing: 15,
    meleeModifier: 1.1,
    rangedVulnerability: 1,
    antiCavalry: 1.05,
    speedModifier: 0.95,
    splashVulnerability: 1.05,
    description: 'Broad front with a second rank to feed the fight.',
  },
  loose: {
    label: 'Loose',
    frontage: 1.35,
    spacing: 30,
    meleeModifier: 0.8,
    rangedVulnerability: 0.65,
    antiCavalry: 0.85,
    speedModifier: 1.05,
    splashVulnerability: 0.4,
    description: 'Dispersed. Greatly reduces siege and arrow casualties.',
  },
  square: {
    label: 'Defensive Square',
    frontage: 0.95,
    spacing: 15,
    meleeModifier: 0.95,
    rangedVulnerability: 1.1,
    antiCavalry: 1.7,
    speedModifier: 0.55,
    splashVulnerability: 1.15,
    description: 'Hollow square. Excellent against cavalry, very slow.',
  },
};

/* ------------------------------------------------------------------ stances */

export interface StanceProfile {
  label: string;
  /** How far from its anchor a group will chase a target, world units. */
  engagementRadius: number;
  damageModifier: number;
  damageTakenModifier: number;
}

export const STANCE_PROFILES = {
  aggressive: {
    label: 'Aggressive',
    engagementRadius: 460,
    damageModifier: 1.1,
    damageTakenModifier: 1.1,
  },
  defensive: {
    label: 'Defensive',
    engagementRadius: 220,
    damageModifier: 1,
    damageTakenModifier: 0.9,
  },
  hold_ground: {
    label: 'Hold Ground',
    engagementRadius: 90,
    damageModifier: 0.95,
    damageTakenModifier: 0.8,
  },
} as const satisfies Record<string, StanceProfile>;

/* ------------------------------------------------------------------- morale */

export const MORALE_THRESHOLDS = {
  confident: 80,
  stable: 55,
  shaken: 35,
  breaking: 15,
} as const;

export const MORALE = {
  /**
   * Morale lost per tick per unit of casualty pressure, where pressure is the
   * decaying casualty accumulator over current strength. Tuned so a group under
   * genuinely heavy attack breaks in roughly forty seconds, not instantly.
   */
  casualtyPenalty: 0.45,
  /** Fraction of the casualty accumulator retained each tick. */
  casualtyDecay: 0.99,
  /** Passive recovery per tick when not taking losses. */
  recoveryPerTick: 0.055,
  /** A broken group out of contact rallies faster, so routs are not permanent. */
  rallyRecoveryPerTick: 0.22,
  /** Extra recovery per tick when a friendly group is close by. */
  supportPerTick: 0.05,
  supportRadius: 620,
  /** Penalty per tick while a nearby friendly group is routing. */
  nearbyRoutPenalty: 0.09,
  /** Penalty per tick while enemies are attacking from more than one arc. */
  flankedPenalty: 0.14,
  /** Bonus per tick while holding a hill or forest. */
  terrainBonus: 0.045,
  /** A routing group recovers to this value before accepting orders again. */
  rallyThreshold: 40,
} as const;

/* ------------------------------------------------------------------ combat */

/** Uniform grid cell size for the broad-phase target search. */
export const SPATIAL_CELL_SIZE = 64;

/**
 * Only one unit in this many re-acquires a target each tick, staggered by index.
 * Combat still resolves every tick; this bounds the cost of the search.
 */
export const ACQUISITION_STRIDE = 8;

/** How far a unit will look for a target beyond its weapon range. */
export const ACQUISITION_MARGIN = 90;

/* --------------------------------------------------------------- visibility */

export const FOG_CELL_SIZE = 50;
export const FOG_COLUMNS = Math.ceil(MAP_WIDTH / FOG_CELL_SIZE);
export const FOG_ROWS = Math.ceil(MAP_HEIGHT / FOG_CELL_SIZE);

/** Vision is recomputed every N ticks; it does not change fast enough to matter. */
export const VISIBILITY_INTERVAL = 4;

/** Enemy contacts older than this are dropped from intelligence entirely. */
export const CONTACT_MEMORY_TICKS = TICKS_PER_SECOND * 90;

/** Reported enemy strength is rounded to this granularity. */
export const STRENGTH_ESTIMATE_GRANULARITY = 25;

/* ------------------------------------------------------------- reinforcement */

export const REINFORCEMENTS = {
  /** Manpower accrued per tick. */
  manpowerPerTick: 0.9,
  /** Manpower required before a wave becomes available. */
  waveCost: 900,
  /** Units delivered per wave. */
  waveSize: 220,
} as const;

/* --------------------------------------------------------------- navigation */

/** How close a group anchor must get to a waypoint before advancing. */
export const WAYPOINT_ARRIVAL_RADIUS = 90;

/** Units slower than this fraction of their slot distance are considered arrived. */
export const SLOT_ARRIVAL_RADIUS = 6;
