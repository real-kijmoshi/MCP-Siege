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

/** How long a fallen soldier stays on the ground before he fades away. */
export const CORPSE_LIFETIME_TICKS = TICKS_PER_SECOND * 3;

/** A deliberately large battlefield: several screens wide at default zoom. */
export const MAP_WIDTH = 8000;
export const MAP_HEIGHT = 5000;

/**
 * Capacity of the unit pool. Sized above the scenario so reinforcements fit.
 *
 * Raised from ten thousand when the guns, the shot and the hospitals joined the
 * order of battle: the two armies now muster around eight and a half thousand
 * men between them, and a long battle banks several reinforcement waves on top
 * of that.
 */
export const UNIT_CAPACITY = 12_000;

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
  /** Splash radius in world units. Only siege and the guns have one. */
  splashRadius: number;
  /**
   * How high the weapon throws its shot, 0 for a flat trajectory and 1 for one
   * that clears anything in the way.
   *
   * This is what decides whether a missile arm can shoot over the heads of its
   * own army. An engine lobs its stone onto a target it cannot see; a bow looses
   * high enough to drop a volley past a friendly line, at a cost in accuracy; a
   * gun and a caliver are aimed along their barrels and want a clear lane. It is
   * the difference between an arm you can park behind the line and one whose
   * position is the whole decision.
   */
  loft: number;
  /**
   * Ticks a piece must stand still before it can fire. Zero for everything a
   * man carries.
   *
   * A gun is not a weapon that happens to be slow; it is a weapon that has to
   * be *placed*. Trailing it forward with the advance means it shoots at
   * nothing, so where the battery stands is a decision made early and paid for
   * late, which is the whole reason artillery is a different arm from siege
   * rather than a longer-ranged version of it.
   */
  deployTicks: number;
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
    loft: 0,
    deployTicks: 0,
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
    loft: 0,
    deployTicks: 0,
    strengthValue: 1,
  },
  archer: {
    label: 'Archers',
    maxHitPoints: 65,
    attack: 4.2,
    range: 230,
    cooldownTicks: 20,
    speed: perSecond(57),
    acceleration: 0.25,
    bodyRadius: 5,
    mass: 0.85,
    chargePower: 0,
    vision: 500,
    splashRadius: 0,
    loft: 0.6,
    deployTicks: 0,
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
    loft: 0,
    deployTicks: 0,
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
    loft: 0,
    deployTicks: 0,
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
    loft: 0.85,
    deployTicks: 0,
    strengthValue: 6,
  },
  handgunner: {
    label: 'Handgunners',
    maxHitPoints: 70,
    attack: 11,
    range: 118,
    cooldownTicks: 46,
    speed: perSecond(52),
    acceleration: 0.22,
    bodyRadius: 5.2,
    mass: 0.9,
    chargePower: 0,
    vision: 360,
    splashRadius: 0,
    loft: 0,
    deployTicks: 0,
    strengthValue: 1.2,
  },
  cannon: {
    label: 'Cannon',
    maxHitPoints: 150,
    attack: 62,
    range: 620,
    cooldownTicks: 150,
    speed: perSecond(16),
    acceleration: 0.06,
    bodyRadius: 11,
    mass: 3.6,
    chargePower: 0,
    vision: 400,
    splashRadius: 30,
    loft: 0.25,
    deployTicks: TICKS_PER_SECOND * 4,
    strengthValue: 8,
  },
  surgeon: {
    label: 'Field Hospital',
    maxHitPoints: 60,
    // Surgeons carry no weapon at all. Nothing in `Combat` ever gives them a
    // target, which is also why they hold no enemy in place by standing near
    // him: a hospital cannot be used as a blocking force.
    attack: 0,
    range: 0,
    cooldownTicks: 40,
    speed: perSecond(50),
    acceleration: 0.2,
    bodyRadius: 5,
    mass: 0.8,
    chargePower: 0,
    vision: 300,
    splashRadius: 0,
    loft: 0,
    deployTicks: 0,
    strengthValue: 0.3,
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
    loft: 0,
    deployTicks: 0,
    strengthValue: 0.4,
  },
};

/**
 * Damage multiplier applied as COUNTER_MATRIX[attacker][defender].
 * Only the tactically meaningful relationships deviate from 1.
 */
export const COUNTER_MATRIX: Record<UnitCategory, Partial<Record<UnitCategory, number>>> = {
  infantry: { archer: 1.4, handgunner: 1.35, siege: 1.5, cannon: 1.6, scout: 1.6, surgeon: 2, heavy_infantry: 0.7 },
  spearman: { cavalry: 2.4, archer: 1.2, handgunner: 1.2, scout: 1.4, surgeon: 1.7, heavy_infantry: 0.8 },
  archer: { infantry: 1.0, heavy_infantry: 0.55, cavalry: 0.8, siege: 1.3, cannon: 1.3, scout: 1.2, surgeon: 1.5 },
  // Shot is the answer to armour that bows have never been: a ball goes through
  // plate a shaft turns on. It pays for that at half the bow's reach and more
  // than twice its reload, so archers standing off at two hundred paces shoot
  // handgunners to pieces without ever being shot at.
  handgunner: { heavy_infantry: 1.7, siege: 1.4, cannon: 1.35, surgeon: 1.5, archer: 1.1, cavalry: 0.7, scout: 0.5 },
  cavalry: { archer: 2.6, handgunner: 2.2, siege: 2.2, cannon: 2.4, scout: 2.0, surgeon: 3, spearman: 0.45, heavy_infantry: 0.75 },
  heavy_infantry: { infantry: 1.3, spearman: 1.2, archer: 1.5, handgunner: 1.5, cannon: 1.4, surgeon: 1.9, cavalry: 0.9 },
  siege: { infantry: 1.2, heavy_infantry: 1.2, spearman: 1.2, archer: 1.1, handgunner: 1.15, cannon: 1.2, cavalry: 0.6 },
  // A gun beats whatever has to stand still to be useful and hits almost
  // nothing that does not. Counter-battery is the sharpest number in the
  // table: the only reliable answer to a battery is another battery, or horse
  // brought round into its rear.
  cannon: { siege: 1.8, cannon: 1.5, heavy_infantry: 1.6, infantry: 1.15, spearman: 1.15, surgeon: 1.2, cavalry: 0.5, scout: 0.35 },
  // Riders who find the baggage. The one matchup scouts have ever had.
  scout: { surgeon: 1.4 },
  surgeon: {},
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
  /** Archer damage delivered from this arrangement. */
  rangedModifier: number;
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
    rangedModifier: 1.14,
    rangedVulnerability: 1,
    antiCavalry: 1,
    speedModifier: 0.9,
    splashVulnerability: 1,
    description: 'Wide frontage. Strongest archer volleys and melee contact.',
  },
  column: {
    label: 'Column',
    frontage: 0.35,
    spacing: 15,
    meleeModifier: 0.8,
    rangedModifier: 0.72,
    rangedVulnerability: 0.9,
    antiCavalry: 0.8,
    speedModifier: 1.25,
    splashVulnerability: 1.2,
    description: 'Narrow and fast. Best for crossings; poor in a firefight.',
  },
  block: {
    label: 'Block',
    frontage: 1,
    spacing: 14,
    meleeModifier: 1.05,
    rangedModifier: 0.92,
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
    rangedModifier: 0.76,
    rangedVulnerability: 1,
    antiCavalry: 0.9,
    speedModifier: 1.1,
    splashVulnerability: 1.1,
    description: 'Offensive shock formation. Strong charge, weak archer volleys.',
  },
  double_line: {
    label: 'Double Line',
    frontage: 1.45,
    spacing: 15,
    meleeModifier: 1.1,
    rangedModifier: 1.08,
    rangedVulnerability: 1,
    antiCavalry: 1.05,
    speedModifier: 0.95,
    splashVulnerability: 1.05,
    description: 'Broad, resilient front with strong sustained volleys.',
  },
  loose: {
    label: 'Loose',
    frontage: 1.35,
    spacing: 30,
    meleeModifier: 0.8,
    rangedModifier: 0.96,
    rangedVulnerability: 0.65,
    antiCavalry: 0.85,
    speedModifier: 1.05,
    splashVulnerability: 0.4,
    description: 'Dispersed. Survives missiles well at a small volley cost.',
  },
  square: {
    label: 'Defensive Square',
    frontage: 0.95,
    spacing: 15,
    meleeModifier: 0.95,
    rangedModifier: 0.82,
    rangedVulnerability: 1.1,
    antiCavalry: 1.7,
    speedModifier: 0.55,
    splashVulnerability: 1.15,
    description: 'Hollow square. Excellent against cavalry, slow with weak volleys.',
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
  /**
   * Penalty per tick at full shock, decaying with it.
   *
   * Deliberately of the same order as being flanked: a charge that lands is one
   * of the two things on the field that can break a formation outright, and it
   * has to be able to do it in the few seconds the shock lasts rather than over
   * the grinding minute a melee takes.
   */
  shockPenalty: 0.16,
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
  // A four-sided assault must decisively outperform the same men fed into one
  // frontage; otherwise flanking is visual noise rather than the core tactic.
  encirclementDamage: 2.5,

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

  /**
   * Share of its top pace a body of men must still carry for its arrival to
   * count as a charge at all.
   */
  chargeSpeedShare: 0.2,
  /**
   * Share of its top pace a formation must get back up to, clear of everyone,
   * before it has a charge in hand again.
   *
   * A charge is delivered once. Men who have hit a line are in a melee from the
   * next second onward, and no amount of shoving turns that back into an
   * impact. Without this a wedge of horse that rode into a flank kept collecting
   * the shock bonus for as long as it stayed there, so the correct use of
   * cavalry was to park it in a melee — the one thing cavalry has never been
   * for. Pulling horse out, turning it round and sending it in again is now a
   * real manoeuvre with a real reward, and it is the reason to keep a lane open
   * behind your own horse.
   */
  reformSpeedShare: 0.55,

  /**
   * Shock carried into a formation by one delivered charge, before it is
   * divided by the number of men who have to absorb it.
   *
   * A charge kills fewer men than the melee that follows it and decides far
   * more battles, because what it actually does is break the formation it lands
   * on. Damage alone could never express that: horse into a steady line came out
   * as a slightly larger casualty figure. This is the term that makes the same
   * impact felt as men giving way.
   */
  shockScale: 1.6,
  /**
   * Share of a formation's shock retained per tick. Slow enough that a regiment
   * ridden into is still unsteady when the second squadron arrives, which is
   * what makes charges worth timing together.
   */
  shockDecay: 0.99,
  /** Converts the press of bodies into ground yielded by a formation. */
  pressureScale: 4.5,
  /** Hard cap on group displacement from combat pressure in one tick. */
  maximumYieldPerTick: 2.2,

  /**
   * What a formation still delivers while it is fighting from the crossing
   * itself, against men who are not.
   *
   * A bridge or a ford is not ground you fight on; it is ground you have to get
   * off. Men coming over it arrive strung out and in no order, unable to bring
   * their numbers to bear on a line already formed on the far bank. Without
   * this term a crossing was merely a slightly slower piece of open field, and
   * the correct play on every divided map was to walk the whole army onto the
   * bridge and out the other side.
   */
  assaultingCrossing: 0.6,
  /**
   * Share of its shoving weight a body of men standing on a crossing can bring.
   *
   * You cannot put your shoulder into a line while the man beside you is on a
   * parapet. Without this a large enough column simply bulldozed the defenders
   * off the far end, whatever they were standing in.
   */
  crossingPressure: 0.4,
} as const;

/* ------------------------------------------------------------- line of fire */

/**
 * Where a missile arm can actually shoot.
 *
 * Until this existed a bow, a caliver, an engine and a gun all shot straight
 * through whatever stood between them and the nearest enemy, which meant the
 * only thing that mattered about a missile regiment was that it was somewhere
 * within range. Archers parked behind the melee were strictly better than
 * archers on a flank, a battery in the middle of the army was as good as one on
 * a ridge, and "mask your own guns" — the oldest mistake in the arm — was not a
 * mistake the game could make.
 *
 * A shot is now traced from the man to his target and the *other* friendly
 * regiments standing in that corridor are counted. A regiment never masks
 * itself: its own ranks are drilled to shoot as a body, which is what the
 * formation `rangedModifier` already prices. What is new is one of your bodies
 * of troops standing in front of another.
 */
export const FIRE = {
  /** Half-width of the traced corridor, world units. About one man either side. */
  corridorHalfWidth: 13,
  /** Men this close to the shooter are beside him, not in front of him. */
  muzzleClearance: 26,
  /**
   * Men this close to the target are the melee itself. They are the ones a
   * short round lands among, so they are counted at full weight rather than
   * excluded.
   */
  targetClearance: 6,
  /** Weighted blockers at which a lane counts as completely masked. */
  saturation: 7,
  /**
   * Weight given to a blocker right at the muzzle, rising to 1 at the target.
   *
   * A friendly regiment fifty paces in front of your archers is an obstacle; the
   * one locked hand to hand with the men you are shooting at is where the volley
   * falls short. Both matter, and they do not matter equally.
   */
  nearMuzzleWeight: 0.3,
  /**
   * Masking removed by shooting from high ground onto lower.
   *
   * This is the second, larger reason a hill is worth taking: not the twelve
   * percent a shot gains from height, but that a battery on a ridge can fire
   * over its own army all day.
   */
  elevationRelief: 0.4,
  /**
   * Loft at or above which a weapon is a lofting one, and will always take the
   * shot rather than hold it.
   */
  loftedTrajectory: 0.5,
  /**
   * Obstruction at which a flat-trajectory weapon refuses the shot outright.
   * A gun crew will not fire through their own infantry, whatever the target.
   */
  holdThreshold: 0.5,
  /**
   * Ticks a masked crew waits before looking again. Short: the lane in front of
   * a battery opens and closes several times a minute in a moving battle.
   */
  holdTicks: 6,
  /** Share of its damage a fully obstructed volley loses. */
  accuracyPenalty: 0.8,
  /**
   * How far a group's reported obstruction moves toward each shot it takes.
   *
   * Measured per shot rather than per tick, because rate of fire varies by a
   * factor of seven across the missile arms and a per-tick average would have
   * made a gun look clearer than a bow simply for firing less often.
   */
  smoothing: 0.25,
  /**
   * Share of the reading retained on a tick where the regiment took no shot at
   * all.
   *
   * A masked regiment is silent most of the time — that is what being masked
   * means — so counting its silence as a clear lane made the one reading that
   * says "this battery is contributing nothing" say the exact opposite. Silence
   * now merely fades the report, over a few seconds, rather than denying it.
   */
  idleDecay: 0.997,
  /** Obstruction at which the roster and the Marshal are told the lane is blocked. */
  reportThreshold: 0.3,
} as const;

/* ----------------------------------------------------------------- crowding */

/**
 * The press of your own men.
 *
 * This is the term that makes ground worth more than numbers. A regiment fights
 * along its frontage, so men beyond what that frontage can hold contribute
 * nothing — and packed hard enough they contribute less than nothing: ranks
 * cannot close, weapons cannot be used, and every arrow that falls finds a
 * body. Without it the strongest move in the game was to push the whole army
 * through one gap in a single mass, because mass had no cost at all.
 *
 * Density is sampled per soldier as the number of *friendly* men within
 * `radius`, which is what makes several regiments stacked on one bridge read
 * exactly as badly as it should. A formation at its natural spacing sits below
 * `comfortable` and pays nothing.
 */
export const CROWDING = {
  /** How far around a man his own crowd is counted, world units. */
  radius: 26,
  /** Neighbours a formation at its own spacing carries. Below this, no penalty. */
  comfortable: 10,
  /** Neighbours at which men can no longer fight at all as a body. */
  crushed: 24,
  /**
   * Only one man in this many samples his neighbourhood each tick.
   *
   * The sample is the one genuinely new per-soldier search in the tick, so this
   * is the whole cost of the system. Eight still asks fifty men of a four
   * hundred strong regiment every step, which is far more than a smoothed
   * reading needs.
   */
  stride: 8,
  /** How fast a group's reported crowding follows the sample, per tick. */
  smoothing: 0.12,
  /** Share of its damage a fully crushed formation loses. */
  damagePenalty: 0.5,
  /** Extra arrow and shell damage taken at full crush. */
  rangedVulnerability: 0.7,
  /** Morale lost per tick at full crush. */
  moralePenalty: 0.075,
  /** Crowding at which the roster and the Marshal are told about it. */
  reportThreshold: 0.4,
} as const;

/* ------------------------------------------------------------------ fatigue */

/**
 * Exhaustion.
 *
 * Men cannot fight indefinitely, and this is what makes a reserve worth
 * holding. Without it one mass of troops could grind from one end of a battle
 * to the other at undiminished strength, so there was never a moment when
 * committing fresh men mattered more than having committed them already. A
 * spent regiment hits softer, steadies slower, and gives ground under a press
 * it would have held ten minutes earlier.
 */
export const FATIGUE = {
  /** Accrued per tick by a formation fully in contact. Spent in about a minute. */
  combatPerTick: 0.00075,
  /** Accrued per tick on the march, so a long approach is not free. */
  marchPerTick: 0.00012,
  /** Shed per tick by a formation standing out of contact. */
  restPerTick: 0.0004,
  /** Share of its damage a wholly spent formation loses. */
  damagePenalty: 0.32,
  /** Morale lost per tick at full exhaustion. */
  moralePenalty: 0.014,
  /** Share of its morale recovery a spent formation forfeits. */
  recoveryDrag: 0.6,
  /** Share of its footing a spent formation loses under physical pressure. */
  yieldPenalty: 0.25,
  /** Fatigue at which a regiment is reported as spent. */
  reportThreshold: 0.55,
} as const;

/* ------------------------------------------------------------ field hospital */

/**
 * The surgeons.
 *
 * Every other system in the battle takes something away and never gives it
 * back: men die, formations tire, morale spent is morale lost. A battle
 * therefore only ever ran one direction, and a regiment pulled out of the line
 * was simply a regiment removed from the battle for good.
 *
 * A field hospital is the one thing on the field that runs the other way. It
 * does nothing at all for troops in contact -- you cannot dress a wound in a
 * melee -- but a regiment withdrawn behind the line and left alone near the
 * hospital gets its lightly wounded back on their feet, recovers its wind
 * faster, and steadies sooner. That turns relieving a spent regiment from a
 * tidy move into a real one, and it gives an army a reason to hold ground
 * behind its own line rather than in front of it.
 *
 * It is emphatically not an economy: nothing is produced, nothing is bought,
 * and no man who has actually fallen comes back.
 */
export const FIELD_SUPPORT = {
  /** How far a hospital's care reaches from its own anchor, world units. */
  radius: 560,
  /**
   * Men one surgeon can look after. A seventy-strong hospital therefore tends
   * a body of about four hundred completely, and a nine-hundred-man legion
   * about half -- so a hospital helps a battered regiment far more than a whole
   * one, which is exactly the order a commander should be treating them in.
   */
  tendedPerSurgeon: 6,
  /**
   * Hit points restored per tick to one tended man, at full care.
   *
   * Slow on purpose: about half a minute to bring a badly cut infantryman back
   * to his feet, so withdrawing a regiment costs real time in the battle line.
   */
  healPerTick: 0.13,
  /** Only one man in this many is looked at each tick. Bounds the whole cost. */
  healStride: 4,
  /** Extra fatigue shed per tick by a fully tended regiment out of contact. */
  restPerTick: 0.00055,
  /** Extra morale recovered per tick by a fully tended regiment. */
  moralePerTick: 0.05,
  /**
   * Engagement above which care stops entirely. Deliberately the same threshold
   * `Fatigue` and `Movement` use, so "in contact" means one thing everywhere.
   */
  maximumEngagement: 0.02,
  /** Care at which the roster and the Marshal are told a regiment is being tended. */
  reportThreshold: 0.15,
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
  // Guns fare worse off level ground than anything else on the field. A battery
  // ordered through a wood is a battery out of the battle, which is what makes
  // the ground between a gun and the position you want it in part of the plan.
  if (terrain === 'forest') {
    if (category === 'cannon') return 0.32;
    if (category === 'cavalry') return 0.58;
    if (category === 'siege') return 0.48;
    return 0.76;
  }
  if (terrain === 'hill') {
    if (category === 'cannon') return 0.46;
    if (category === 'cavalry') return 0.72;
    if (category === 'siege') return 0.6;
    return 0.84;
  }
  if (terrain === 'village') {
    if (category === 'cannon') return 0.6;
    if (category === 'cavalry') return 0.62;
    if (category === 'siege') return 0.7;
    return 0.86;
  }
  if (terrain === 'crossing') {
    if (category === 'cannon') return 0.72;
    return category === 'cavalry' ? 0.82 : 0.9;
  }
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
  handgunner: 'SHT',
  cavalry: 'CAV',
  heavy_infantry: 'HVY',
  siege: 'SGE',
  cannon: 'GUN',
  scout: 'SCT',
  surgeon: 'MED',
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
