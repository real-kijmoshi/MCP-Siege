import {
  CONTACT,
  COUNTER_MATRIX,
  CROWDING,
  FATIGUE,
  FIRE,
  FORMATION_PROFILES,
  MORALE,
  MORALE_THRESHOLDS,
  STANCE_PROFILES,
  TICKS_PER_SECOND,
  UNIT_STATS,
  counterMultiplier,
  terrainDefenceModifier,
  terrainSpeedModifier,
} from '../config/battle';
import {
  FORMATIONS,
  STANCES,
  UNIT_CATEGORIES,
  type Formation,
  type Stance,
  type UnitCategory,
} from '../types/domain';

/**
 * The rulebook, as numbers.
 *
 * Everything a Marshal needs in order to reason rather than guess. Until this
 * existed the whole combat model — the counter table, what a formation actually
 * multiplies, what a flank is worth, what a charge costs to set up — was
 * knowable only by reading tool descriptions and inferring, so an agent played
 * on folk memory of other games: it put horse into spears, parked archers
 * behind the melee, and had no way to discover it had been wrong.
 *
 * Every figure here is read out of `config/battle.ts` rather than restated, so
 * the doctrine an agent is given and the rules the simulation runs cannot
 * drift apart. It takes no state and answers the same for both sides: this is
 * the manual, not intelligence.
 */

/** Multiplier at or above which a matchup is worth naming as a counter. */
const NOTABLE_ADVANTAGE = 1.2;
/** Multiplier at or below which a matchup is worth naming as a weakness. */
const NOTABLE_WEAKNESS = 0.85;

const TERRAIN_KINDS = ['open', 'forest', 'hill', 'village', 'crossing'] as const;
type DoctrineTerrain = (typeof TERRAIN_KINDS)[number];

export interface ArmDoctrine {
  category: UnitCategory;
  label: string;
  /** One line on what the arm is for. */
  role: string;
  reach: number;
  /** Damage a single man delivers per second before any modifier. */
  damagePerSecond: number;
  hitPoints: number;
  /** Paces per second on open ground in an ordinary formation. */
  pace: number;
  vision: number;
  /** Categories this arm hits harder than average, worst first for the victim. */
  strongAgainst: Array<{ category: UnitCategory; multiplier: number }>;
  /** Categories that hit this arm hardest. */
  vulnerableTo: Array<{ category: UnitCategory; multiplier: number }>;
  notes: string[];
}

export interface FormationDoctrine {
  formation: Formation;
  label: string;
  melee: number;
  ranged: number;
  /** Missile damage taken, where 1 is an ordinary line. */
  missileVulnerability: number;
  /** Incoming cavalry damage is divided by this. */
  antiCavalry: number;
  splashVulnerability: number;
  pace: number;
  description: string;
  useWhen: string;
}

export interface StanceDoctrine {
  stance: Stance;
  label: string;
  /** How far from its ground a group will chase, in paces. */
  engagementRadius: number;
  damage: number;
  damageTaken: number;
  description: string;
}

export interface MechanicDoctrine {
  id: string;
  title: string;
  rule: string;
  numbers: Record<string, number>;
  answer: string;
}

export interface TerrainDoctrine {
  terrain: DoctrineTerrain;
  /** Melee damage a defender standing here takes, where 1 is open field. */
  meleeDamageTaken: number;
  missileDamageTaken: number;
  /** Pace on this ground by broad role, where 1 is open field. */
  pace: Record<string, number>;
  note: string;
}

export interface Doctrine {
  note: string;
  arms: ArmDoctrine[];
  formations: FormationDoctrine[];
  stances: StanceDoctrine[];
  terrain: TerrainDoctrine[];
  mechanics: MechanicDoctrine[];
  playbook: string[];
}

const ARM_ROLES: Record<UnitCategory, string> = {
  infantry: 'The body of the army. Cheap, steady, and the thing that holds ground.',
  spearman: 'A hedge. The only reliable answer to horse, and poor at everything else.',
  archer:
    'Attrition at two hundred paces. Lofts over a friendly line at a cost, and dies to anything that reaches it.',
  cavalry:
    'The decisive arm. Fast enough to choose where it fights, ruinous against a flank or a rear, and destroyed by a spear front.',
  heavy_infantry:
    'Armour. Slow, expensive, and very hard to shift once it has been placed; shot goes through it where arrows do not.',
  siege: 'An engine that lobs its shot over everything and cannot defend itself.',
  handgunner:
    'Shot that goes through plate. Half a bow’s reach, twice its reload, and it wants a clear lane.',
  cannon:
    'The heaviest weapon on the field and the least mobile. It must stand still to fire at all, and it is answered only by another battery or by horse in its rear.',
  surgeon: 'A field hospital. Carries no weapon and tends regiments out of contact.',
  scout: 'Eyes. Twice anyone else’s sight, no weight in a fight, and the way fog is lifted.',
};

function armNotes(category: UnitCategory): string[] {
  const stats = UNIT_STATS[category];
  const notes: string[] = [];
  if (stats.deployTicks > 0) {
    notes.push(
      `Must stand still ${Math.round(stats.deployTicks / TICKS_PER_SECOND)}s before it can fire. ` +
        'A battery still on the march shoots at nothing.',
    );
  }
  if (stats.range >= 100) {
    notes.push(
      stats.loft >= FIRE.loftedTrajectory
        ? 'Lofts its shot: it will fire over a friendly line, at a heavy cost in accuracy.'
        : 'Flat trajectory: it holds its fire rather than shoot through your own men. Give it a flank or a ridge.',
    );
  }
  if (stats.splashRadius > 0) {
    notes.push(`Splash of ${stats.splashRadius} paces; worth twice as much against a packed formation.`);
  }
  if (stats.chargePower > 0) {
    notes.push(
      'Carries a charge, delivered once on arrival. It is regained only by breaking clean off and getting back up to pace.',
    );
  }
  if (stats.attack === 0) notes.push('Unarmed. It cannot fight and cannot pin anything.');
  return notes;
}

function armDoctrine(category: UnitCategory): ArmDoctrine {
  const stats = UNIT_STATS[category];

  const strongAgainst = UNIT_CATEGORIES.map((other) => ({
    category: other,
    multiplier: counterMultiplier(category, other),
  }))
    .filter((entry) => entry.multiplier >= NOTABLE_ADVANTAGE)
    .sort((a, b) => b.multiplier - a.multiplier);

  const vulnerableTo = UNIT_CATEGORIES.map((other) => ({
    category: other,
    multiplier: counterMultiplier(other, category),
  }))
    .filter((entry) => entry.multiplier >= NOTABLE_ADVANTAGE)
    .sort((a, b) => b.multiplier - a.multiplier);

  const notes = armNotes(category);
  const resists = UNIT_CATEGORIES.filter(
    (other) => counterMultiplier(other, category) <= NOTABLE_WEAKNESS,
  );
  if (resists.length > 0) notes.push(`Shrugs off ${resists.join(', ')}.`);

  return {
    category,
    label: stats.label,
    role: ARM_ROLES[category],
    reach: stats.range,
    damagePerSecond:
      Math.round((stats.attack / stats.cooldownTicks) * TICKS_PER_SECOND * 100) / 100,
    hitPoints: stats.maxHitPoints,
    pace: Math.round(stats.speed * TICKS_PER_SECOND),
    vision: stats.vision,
    strongAgainst,
    vulnerableTo,
    notes,
  };
}

const FORMATION_USE: Record<Formation, string> = {
  line: 'Fighting a frontage, and the strongest volleys. The default for a firefight.',
  column: 'Getting somewhere: crossings, roads, and redeploying behind your own line. Never fight in it.',
  block: 'When you do not know what is coming.',
  wedge: 'Horse or heavy foot going in. It is a formation for arriving, not for standing.',
  double_line: 'A front that has to hold and keep shooting while it does.',
  loose: 'Under bombardment, or advancing into archers. It gives up melee weight for survival.',
  square: 'Cavalry is coming and you have no spears. It is barely mobile; commit to it.',
};

function formationDoctrine(formation: Formation): FormationDoctrine {
  const profile = FORMATION_PROFILES[formation];
  return {
    formation,
    label: profile.label,
    melee: profile.meleeModifier,
    ranged: profile.rangedModifier,
    missileVulnerability: profile.rangedVulnerability,
    antiCavalry: profile.antiCavalry,
    splashVulnerability: profile.splashVulnerability,
    pace: profile.speedModifier,
    description: profile.description,
    useWhen: FORMATION_USE[formation],
  };
}

const TERRAIN_NOTES: Record<DoctrineTerrain, string> = {
  open: 'No cover and no advantage. Numbers and matchups decide it.',
  forest:
    'Breaks up an attack and swallows missiles. Cavalry loses most of its advantage in it and guns should never enter it.',
  hill:
    'Defenders take less, and a missile arm on the crest both hits harder and shoots over its own army. The most valuable ground on any map.',
  village: 'The strongest cover on the field, and slow to move through.',
  crossing:
    'Not ground to fight on. Men attacking off a crossing deliver a fraction of their weight and cannot bring their numbers to bear.',
};

function terrainDoctrine(terrain: DoctrineTerrain): TerrainDoctrine {
  return {
    terrain,
    meleeDamageTaken: terrainDefenceModifier(terrain, false),
    missileDamageTaken: terrainDefenceModifier(terrain, true),
    pace: {
      foot: terrainSpeedModifier('infantry', terrain),
      cavalry: terrainSpeedModifier('cavalry', terrain),
      siege: terrainSpeedModifier('siege', terrain),
      cannon: terrainSpeedModifier('cannon', terrain),
    },
    note: TERRAIN_NOTES[terrain],
  };
}

function mechanics(): MechanicDoctrine[] {
  return [
    {
      id: 'flanks',
      title: 'Where the blow lands',
      rule:
        'A formation is only strong along the front it is dressed to. Blows arriving from the ' +
        'side and from behind are multiplied, which is what pays for every manoeuvre that gets ' +
        'troops around a wing.',
      numbers: { flank: CONTACT.flankDamage, rear: CONTACT.rearDamage },
      answer: 'Face the threat, or put a second regiment on the quarter it is coming from.',
    },
    {
      id: 'encirclement',
      title: 'Being surrounded',
      rule:
        'Attacks are bucketed into eight arcs around a formation. Three arcs is an ordinary wide ' +
        'frontage; beyond that pressure rises with the square of the share of the perimeter under ' +
        'attack, up to the figure below at a complete ring. It is the fastest way a regiment dies.',
      numbers: {
        arcs: CONTACT.arcCount,
        frontalArcs: CONTACT.frontalArcs,
        envelopedArcs: CONTACT.envelopedArcs,
        extraDamageAtFullRing: CONTACT.encirclementDamage,
      },
      answer:
        'Answer it at once: relieve the quarter it is coming from, or pull the regiment out before it is closed.',
    },
    {
      id: 'charge',
      title: 'The charge',
      rule:
        'Men arriving at pace carry an impact, delivered exactly once. It is regained only by ' +
        'breaking clean off and getting back above the share of top pace below. A charge also ' +
        'shakes the formation it lands on, and morale reads that shock at the same order as ' +
        'being flanked, so it breaks lines the melee alone never would.',
      numbers: {
        maximumExtraDamage: CONTACT.maximumChargeDamage,
        removedByBracedSpearsOrSquare: CONTACT.braceReduction,
        paceShareToCount: CONTACT.chargeSpeedShare,
        paceShareToReform: CONTACT.reformSpeedShare,
      },
      answer:
        'Never park horse in a melee: pull it out, turn it, send it in again. Keep a lane open behind it. ' +
        'Against a charge, spears or a square, and not in the aggressive stance.',
    },
    {
      id: 'pursuit',
      title: 'Breaking and pursuit',
      rule:
        'Men who have broken cannot defend themselves. A rout is where an army is actually ' +
        'destroyed, not the melee before it.',
      numbers: { damageAgainstRouting: CONTACT.pursuitDamage, rallyAt: MORALE.rallyThreshold },
      answer: 'Follow a broken regiment with horse. Do not let your own routers be followed.',
    },
    {
      id: 'crossings',
      title: 'Fighting off a crossing',
      rule:
        'A bridge or ford is ground you have to get off. Men still on it deliver a fraction of ' +
        'their weight against a line already formed on the far bank, and can put only a fraction ' +
        'of their shoving weight behind it.',
      numbers: {
        damageFromTheCrossing: CONTACT.assaultingCrossing,
        shovingWeight: CONTACT.crossingPressure,
      },
      answer:
        'Hold the far end rather than the crossing. Never feed an army over one against a formed line.',
    },
    {
      id: 'crowding',
      title: 'The press',
      rule:
        'Men packed shoulder to shoulder cannot use their weapons, and a packed body is what ' +
        'archers and guns exist for. This is what happens when several regiments are pushed ' +
        'through one defile at once.',
      numbers: {
        damageLostWhenCrushed: CROWDING.damagePenalty,
        extraMissileDamageTaken: CROWDING.rangedVulnerability,
        reportedAbove: CROWDING.reportThreshold,
      },
      answer: 'Give it room: fewer regiments through at once, or spread into loose order.',
    },
    {
      id: 'fatigue',
      title: 'Exhaustion',
      rule:
        'Men who have been fighting for a quarter of an hour swing short and give ground. This ' +
        'is what makes a reserve worth holding.',
      numbers: { damageLostWhenSpent: FATIGUE.damagePenalty, reportedAbove: FATIGUE.reportThreshold },
      answer: 'Relieve a spent regiment with a fresh one, and withdraw it near a field hospital.',
    },
    {
      id: 'line_of_fire',
      title: 'The line of fire',
      rule:
        'A shot is traced from the man to his target and your other regiments standing in that ' +
        'corridor are counted. A flat-trajectory arm — handgunners and guns — holds its fire ' +
        'rather than shoot through your own men. A lofting arm — bows and engines — shoots over ' +
        'at a heavy cost in accuracy. Shooting from a hill onto lower ground removes much of it.',
      numbers: {
        obstructionThatStopsAFlatShot: FIRE.holdThreshold,
        loftAtWhichAnArmShootsAnyway: FIRE.loftedTrajectory,
        maskingRemovedByHighGround: FIRE.elevationRelief,
        reportedAbove: FIRE.reportThreshold,
      },
      answer:
        'Put missile troops on a flank or on a ridge, not behind the melee. get_armies reports a masked regiment.',
    },
    {
      id: 'morale',
      title: 'Morale',
      rule:
        'Battles are decided by formations giving way. Casualties, being flanked, taking a ' +
        'charge, and friendly regiments breaking nearby all drive it down; standing on good ' +
        'ground, being supported by a formation nearby, and being out of contact drive it up. ' +
        'A regiment that has been badly cut about can never fully recover its confidence.',
      numbers: {
        confidentAbove: MORALE_THRESHOLDS.confident,
        steadyAbove: MORALE_THRESHOLDS.stable,
        shakenBelow: MORALE_THRESHOLDS.shaken,
        breakingBelow: MORALE_THRESHOLDS.breaking,
        rallyAt: MORALE.rallyThreshold,
        ceilingOnceBloodied: MORALE.bloodiedFloor,
      },
      answer:
        'Keep regiments within supporting distance of one another, and pull a shaken one out before it breaks.',
    },
    {
      id: 'pinning',
      title: 'Being held',
      rule:
        'A formation in contact cannot march away. Read one way that is a warning; read the ' +
        'other it is confirmation that a blocking force is doing its job.',
      numbers: { pinnedAtEngagement: CONTACT.pinEngagement, paceWhilePinned: CONTACT.pinnedSpeed },
      answer:
        'Pin with cheap foot and decide the fight elsewhere. Do not plan a march for a regiment already pinned.',
    },
  ];
}

export function getDoctrine(): Doctrine {
  return {
    note:
      'The rules of this battlefield, as the simulation actually runs them. Every figure is a ' +
      'multiplier on damage unless it says otherwise, and all of them are read out of the ' +
      'game’s own tuning rather than restated here.',
    arms: UNIT_CATEGORIES.map(armDoctrine),
    formations: FORMATIONS.map(formationDoctrine),
    stances: STANCES.map((stance) => ({
      stance,
      label: STANCE_PROFILES[stance].label,
      engagementRadius: STANCE_PROFILES[stance].engagementRadius,
      damage: STANCE_PROFILES[stance].damageModifier,
      damageTaken: STANCE_PROFILES[stance].damageTakenModifier,
      description: STANCE_PROFILES[stance].description,
    })),
    terrain: TERRAIN_KINDS.map(terrainDoctrine),
    mechanics: mechanics(),
    playbook: [
      'The battle is won by taking the enemy king, not by attrition. Everything else is how you make the opening.',
      'Read get_battle_overview, then get_armies. Both name what is wrong before you have to spot it.',
      'Before committing a regiment, call assess_engagement. It prices the matchup, the ground and the state of the men.',
      'Before timing anything, call estimate_march. Horse, foot and guns do not arrive together.',
      'Order, then call watch_battle rather than polling. It returns the moment something you named happens, with what changed while you waited.',
      'Fog is real: an empty intelligence report is an unscouted front, not an empty one. Send scouts.',
      'Guns and engines must be placed early. A battery on the march is baggage.',
      'Win the matchup before you win the fight: spears meet horse, horse takes archers and guns, shot takes armour, bows take everything unarmoured at range.',
    ],
  };
}
