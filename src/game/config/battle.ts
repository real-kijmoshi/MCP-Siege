/**
 * Tuning constants for the battle simulation.
 *
 * Everything that shapes tactical decisions is centralised here so balance can be
 * adjusted without touching systems. All rates are expressed per tick; the
 * simulation never reads wall-clock time.
 */

import { UNIT_CATEGORIES, type Formation, type UnitCategory } from '../types/domain';

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
  /** How quickly the unit can change its velocity, 0..1 per tick. */
  acceleration: number;
  /** Physical footprint used by the local collision solver. */
  bodyRadius: number;
  /** Relative weight behind a melee impact. */
  mass: number;
  /** Extra damage delivered when arriving at speed. */
  chargePower: number;
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
    speed: perSecond(58),
    acceleration: 0.24,
    bodyRadius: 5.5,
    mass: 1,
    chargePower: 0.18,
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
    speed: perSecond(55),
    acceleration: 0.22,
    bodyRadius: 5.8,
    mass: 1.05,
    chargePower: 0.1,
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
    speed: perSecond(57),
    acceleration: 0.25,
    bodyRadius: 5,
    mass: 0.85,
    chargePower: 0,
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
    speed: perSecond(118),
    acceleration: 0.16,
    bodyRadius: 8.5,
    mass: 2.4,
    chargePower: 0.9,
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
    speed: perSecond(44),
    acceleration: 0.14,
    bodyRadius: 6.5,
    mass: 1.65,
    chargePower: 0.3,
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
    speed: perSecond(25),
    acceleration: 0.08,
    bodyRadius: 10,
    mass: 3.2,
    chargePower: 0,
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
    speed: perSecond(140),
    acceleration: 0.3,
    bodyRadius: 4.5,
    mass: 0.7,
    chargePower: 0.12,
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
  description: string;
}

export const STANCE_PROFILES = {
  aggressive: {
    label: 'Aggressive',
    engagementRadius: 460,
    damageModifier: 1.1,
    damageTakenModifier: 1.1,
    description: 'Chases targets far from the line. Hits harder, takes more.',
  },
  defensive: {
    label: 'Defensive',
    engagementRadius: 220,
    damageModifier: 1,
    damageTakenModifier: 0.9,
    description: 'Holds a sector and answers what comes into it.',
  },
  hold_ground: {
    label: 'Hold Ground',
    engagementRadius: 90,
    damageModifier: 0.95,
    damageTakenModifier: 0.8,
    description: 'Will not be drawn off its ground. Steadiest under attack.',
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
   * decaying casualty accumulator over current strength.
   *
   * At 0.45 a regiment losing men fast enough to be wiped out in a minute lost
   * only about forty-five morale over that minute — so it died to the last man
   * without ever breaking, and the whole morale layer was decoration. Battles
   * are supposed to be decided by formations giving way, not by mutual
   * annihilation, and a line only bends if this term can actually break it.
   */
  casualtyPenalty: 1.5,
  /** Fraction of the casualty accumulator retained each tick. */
  casualtyDecay: 0.99,
  /** Passive recovery per tick when not taking losses. */
  recoveryPerTick: 0.032,
  /**
   * A broken group out of contact rallies faster, so routs are not permanent.
   * Kept well below the old value: at 0.22 a shattered regiment was back to
   * full confidence twenty seconds after quitting the field, which made
   * breaking an army meaningless.
   */
  rallyRecoveryPerTick: 0.12,
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
  /**
   * Ceiling on morale imposed by casualties already taken.
   *
   * Rallying restores order, not numbers. Without this a regiment cut from
   * four hundred men to thirty reported full confidence a minute later, which
   * made the one bar the player actually reads say nothing about the state of
   * the formation it belonged to.
   */
  bloodiedFloor: 35,
} as const;

/* ------------------------------------------------------------------ combat */

/** Uniform grid cell size for the broad-phase target search. */
export const SPATIAL_CELL_SIZE = 64;

/**
 * Only one unit in this many re-acquires a target each tick, staggered by index.
 * Combat still resolves every tick; this bounds the cost of the search.
 */
export const ACQUISITION_STRIDE = 8;

/**
 * The stride used by a man who has no target at all, rather than one looking
 * for a better one.
 *
 * In a heavy melee the enemy in front of you dies every few seconds, and on the
 * ordinary stride his killer then stood idle for up to eight ticks waiting for
 * his turn to look around again. Attacks come every twelve to sixteen ticks, so
 * that idling was throwing away a third of the army's output precisely where
 * the fighting was thickest — which is why overwhelming numbers never felt
 * overwhelming.
 */
export const REACQUISITION_STRIDE = 3;

/** How far a unit will look for a target beyond its weapon range. */
export const ACQUISITION_MARGIN = 90;

/**
 * Contact, envelopment and pursuit.
 *
 * These are the terms that make position matter more than arithmetic. Without
 * them a battle was two damage pools draining into each other: a column could
 * march straight through a blocking line without slowing, a regiment taken in
 * the rear fought exactly as well as one facing its enemy, and men who had
 * already broken walked off the field unharmed. Encircling an enemy is the
 * single most expensive thing a commander can arrange, so it has to be the
 * single most decisive.
 */
export const CONTACT = {
  /**
   * Share of a group's men in contact at which its advance is fully checked.
   * A line's front rank is roughly a twentieth of its strength, so this is
   * reached as soon as the whole frontage is actually fighting.
   */
  pinEngagement: 0.06,
  /** Fraction of march speed a fully pinned formation keeps. */
  pinnedSpeed: 0.06,

  /** Bearings are bucketed into this many arcs around the formation. */
  arcCount: 8,
  /**
   * Arcs of attack that still count as an ordinary frontal fight. Men pressed
   * along a single front occupy two or three arcs simply because the line is
   * wide; envelopment starts above that.
   */
  frontalArcs: 3,
  /** Arcs at which a formation counts as completely ringed. */
  envelopedArcs: 7,
  /** Extra damage taken at full encirclement. */
  encirclementDamage: 1.1,

  /** Cone, in radians either side of the facing, that counts as the front. */
  frontArc: Math.PI / 3,
  /** Cone either side of the facing beyond which a blow lands in the rear. */
  flankArc: (Math.PI * 2) / 3,
  /** Damage multiplier for a blow landing on a formation's flank. */
  flankDamage: 1.3,
  /** Damage multiplier for a blow landing on its rear. */
  rearDamage: 1.55,

  /**
   * Multiplier against men who have already broken. A rout is where an army is
   * actually destroyed; troops who have turned their backs cannot defend
   * themselves, and letting them stroll home intact made breaking a formation
   * worth nothing.
   */
  pursuitDamage: 2.1,

  /** Maximum extra damage produced by arriving with full charge momentum. */
  maximumChargeDamage: 0.9,
  /** A braced spear front or square removes this share of incoming charge. */
  braceReduction: 0.72,
  /** Converts the press of bodies into ground yielded by a formation. */
  pressureScale: 4.5,
  /** Hard cap on group displacement from combat pressure in one tick. */
  maximumYieldPerTick: 2.2,
} as const;

/* --------------------------------------------------------------- movement */

export const PHYSICS = {
  /** How strongly overlapping unit bodies separate on each fixed step. */
  separationStrength: 0.48,
  /** Only one index cohort resolves body overlap each tick; velocity persists. */
  separationStride: 4,
  /** Velocity retained while a unit has no meaningful movement goal. */
  idleDamping: 0.58,
  /** Highest body radius in UNIT_STATS, used to bound neighbour searches. */
  maximumBodyRadius: 10,
  /** Maximum radians a marching formation can rotate in one tick. */
  groupTurnRate: 0.08,
  /** How close friendly regiment anchors may pack before locally steering apart. */
  groupPersonalSpace: 150,
} as const;

/** March pace on ground that disrupts ranks, by broad troop role. */
export function terrainSpeedModifier(category: UnitCategory, terrain: string): number {
  if (terrain === 'forest') {
    if (category === 'cavalry') return 0.58;
    if (category === 'siege') return 0.48;
    return 0.76;
  }
  if (terrain === 'hill') {
    if (category === 'cavalry') return 0.72;
    if (category === 'siege') return 0.6;
    return 0.84;
  }
  if (terrain === 'village') {
    if (category === 'cavalry') return 0.62;
    if (category === 'siege') return 0.7;
    return 0.86;
  }
  if (terrain === 'crossing') return category === 'cavalry' ? 0.82 : 0.9;
  return 1;
}

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

/* ------------------------------------------------------------- the objective */

/**
 * Capturing the king.
 *
 * The battle is won by taking the opposing sovereign, not by attrition. He
 * rides with his Royal Guard, so he is only reachable once that guard has been
 * broken or drawn away — which is what turns the whole map into a problem of
 * making an opening rather than of winning every melee.
 */
export const OBJECTIVE = {
  /** How often the capture contest is evaluated, in ticks. */
  interval: 5,
  /** Ground around the king that must be held to take him. */
  captureRadius: 420,
  /**
   * Strength that must be inside the ring before a capture even begins, so a
   * lone scout riding past a king cannot start taking him.
   */
  minimumAssault: 110,
  /** Attackers must outweigh defenders by this factor to make progress. */
  dominance: 1.25,
  /** Capture percentage added per interval at parity-plus-one dominance. */
  progressPerInterval: 1,
  /** Ceiling on the dominance multiplier, so numbers cannot take a king instantly. */
  maximumRate: 3,
  /** Percentage recovered per interval once the ring is relieved. */
  decayPerInterval: 0.7,

  /** Men fight harder in sight of their sovereign. Morale per tick. */
  rallyBonus: 0.05,
  rallyRadius: 900,
  /**
   * Dread while the king is beset, applied to every group in the army. Kept
   * small deliberately: it must apply pressure over a minute, not collapse an
   * army faster than it can march to the rescue.
   */
  besiegedPenalty: 0.03,

  /**
   * An army below this share of its original numbers concedes the field.
   *
   * Fifteen percent meant conceding only after losing five men in six, which
   * no engagement ever reached: two armies would fight down to half strength,
   * stall, and the battle would simply never end. Real armies break long
   * before annihilation, and attrition has to be able to decide a field or
   * every casualty on it is meaningless.
   */
  collapsePercent: 34,
  /** No side may collapse before this, so the opening cannot decide anything. */
  graceSeconds: 60,
} as const;

/* --------------------------------------------------------------- navigation */

/** How close a group anchor must get to a waypoint before advancing. */
export const WAYPOINT_ARRIVAL_RADIUS = 90;

/** Units slower than this fraction of their slot distance are considered arrived. */
export const SLOT_ARRIVAL_RADIUS = 6;

/* --------------------------------------------------------------- troop role */

/**
 * How a troop type is named at a glance.
 *
 * The counter matrix above is the deepest tactical system in the game and it
 * was, until these tokens existed, completely invisible: a roster row read
 * "Legion I · line" and never said whether those men carried spears or bows.
 * A three-letter token fits beside a name at any zoom, which is what lets a
 * commander see a cavalry wedge coming at his archers in time to answer it.
 */
export const CATEGORY_TOKEN: Record<UnitCategory, string> = {
  infantry: 'INF',
  spearman: 'SPR',
  archer: 'ARC',
  cavalry: 'CAV',
  heavy_infantry: 'HVY',
  siege: 'SGE',
  scout: 'SCT',
};

/** Threshold at which a counter is worth telling the player about. */
const COUNTER_NOTABLE = 1.25;
const COUNTERED_NOTABLE = 0.8;

function matchupList(
  category: UnitCategory,
  predicate: (multiplier: number) => boolean,
): UnitCategory[] {
  const matches: UnitCategory[] = [];
  // Iterate the canonical order, never the object's own key order, so the
  // same hint always reads the same way.
  for (const other of UNIT_CATEGORIES) {
    if (predicate(counterMultiplier(category, other))) matches.push(other);
  }
  return matches;
}

/** Troop types this one tears through. */
export function strongAgainst(category: UnitCategory): UnitCategory[] {
  return matchupList(category, (multiplier) => multiplier >= COUNTER_NOTABLE);
}

/** Troop types that blunt this one when it attacks them. */
export function weakAgainst(category: UnitCategory): UnitCategory[] {
  return matchupList(category, (multiplier) => multiplier <= COUNTERED_NOTABLE);
}

/** Troop types that tear through this one. The half a defender needs to know. */
export function preyedOnBy(category: UnitCategory): UnitCategory[] {
  const threats: UnitCategory[] = [];
  for (const other of UNIT_CATEGORIES) {
    if (other !== category && counterMultiplier(other, category) >= COUNTER_NOTABLE) {
      threats.push(other);
    }
  }
  return threats;
}

/** One line of plain tactical advice for a selected regiment. */
export function describeMatchups(category: UnitCategory): string {
  const names = (list: UnitCategory[]): string =>
    list.map((entry) => UNIT_STATS[entry].label.toLowerCase()).join(', ');

  const strong = strongAgainst(category);
  const threats = preyedOnBy(category);
  const parts: string[] = [];
  if (strong.length > 0) parts.push(`strong vs ${names(strong)}`);
  if (threats.length > 0) parts.push(`weak to ${names(threats)}`);
  return parts.length === 0 ? 'No decisive matchups.' : `${parts.join(' · ')}.`;
}
