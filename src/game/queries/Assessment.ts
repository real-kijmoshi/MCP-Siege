import {
  CONTACT,
  CROWDING,
  FATIGUE,
  FIRE,
  FORMATION_PROFILES,
  HIGH_GROUND_FIRE,
  STANCE_PROFILES,
  TICKS_PER_SECOND,
  UNIT_STATS,
  counterMultiplier,
  terrainDefenceModifier,
} from '../config/battle';
import { findGroup, type GameState } from '../simulation/GameState';
import { ZONES, isBeyondBarrier, terrainAt } from '../simulation/Zones';
import {
  UNIT_CATEGORIES,
  type ArmyGroup,
  type EnemyContact,
  type PlayerId,
  type UnitCategory,
  type ZoneId,
} from '../types/domain';

/**
 * Pricing a fight before ordering it.
 *
 * The combat model is deep — a counter table, formation profiles, stances,
 * arcs, terrain, the press, exhaustion, the line of fire — and every one of
 * those terms was invisible from outside. A Marshal could read that a regiment
 * was four hundred archers and that a contact was three hundred horse, and had
 * no way to learn that the second number was going to win: it had to guess the
 * matchup and then read the casualty list to find out.
 *
 * This runs the same multipliers the simulation runs, over what the commanding
 * side actually knows, and reports the arithmetic rather than a verdict alone.
 * It never sees more than the fog allows: enemy strength is the rounded
 * estimate from intelligence, enemy composition is the list of arms that have
 * been seen, and an enemy's own formation, stance, morale and exhaustion are
 * unknown and are stated as unknown rather than assumed away.
 */

export type EngagementVerdict = 'decisive' | 'favourable' | 'even' | 'costly' | 'losing';

export interface EngagementInput {
  groupIds: readonly string[];
  targetGroupId?: string;
  targetZone?: ZoneId;
}

export interface AttackerLine {
  groupId: string;
  name: string;
  strength: number;
  formation: string;
  stance: string;
  morale: number;
  /** Damage this regiment delivers per second into this particular enemy. */
  damagePerSecond: number;
  /** What is currently costing it, each a multiplier below 1. */
  penalties: Record<string, number>;
  warnings: string[];
}

export interface EngagementTarget {
  kind: 'group' | 'zone';
  name: string;
  zone: ZoneId;
  zoneName: string;
  terrain: string;
  estimatedStrength: number;
  composition: UnitCategory[];
  visibleNow: boolean;
  lastSeenSecondsAgo: number;
}

export interface Matchup {
  yours: UnitCategory;
  theirs: UnitCategory;
  multiplier: number;
  note: string;
}

export interface EngagementAssessment {
  target: EngagementTarget;
  attackers: AttackerLine[];
  yourDamagePerSecond: number;
  theirDamagePerSecond: number;
  /** How much longer you last than they do. Above 1 is in your favour. */
  advantage: number;
  secondsToBreakThem: number;
  secondsToBreakYou: number;
  verdict: EngagementVerdict;
  summary: string;
  matchups: Matchup[];
  recommendations: string[];
  assumptions: string[];
}

export class AssessmentError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly suggestions: string[] = [],
  ) {
    super(message);
    this.name = 'AssessmentError';
  }
}

/** Damage one man of this arm delivers per second, before any modifier. */
function rawDamagePerSecond(category: UnitCategory): number {
  const stats = UNIT_STATS[category];
  return (stats.attack / stats.cooldownTicks) * TICKS_PER_SECOND;
}

function isMissile(category: UnitCategory): boolean {
  return UNIT_STATS[category].range >= 100;
}

/**
 * Men of a body that are actually in contact, measured against the simulation.
 *
 * This is the correction that decides whether this tool is worth calling. A
 * melee is fought along a frontage, not by everybody at once: put eight hundred
 * foot against three hundred and twenty-five armoured men and the eight hundred
 * lose badly, because only the front rank of each is ever fighting and man for
 * man the armour is three times the soldier. Summing whole regiments said the
 * opposite — it called that fight decisive — which is exactly the mistake an
 * external commander would then go and make.
 *
 * Contact grows with the square root of a body's strength, because a formation
 * is about as wide as its own square root, and it is bounded by the smaller of
 * the two bodies, because two lines share one front. Fitted against duels run
 * in the simulation itself: 50, 100, 300 and 600 a side, all inside twenty
 * percent.
 */
const MELEE_FRONT = 0.7;

/**
 * The reach of a sword-armed man, in paces.
 *
 * Frontage is not the same for every arm: a spear is half again as long as a
 * sword, so a spear front gets a second rank's points into a fight a sword
 * front cannot. Without this, two hundred foot and two hundred spears read as
 * an even match, and in the simulation the spears win it.
 */
const MELEE_BASE_REACH = 14;

/**
 * How much of a missile body has the target in range at all.
 *
 * A regiment is deeper than it looks: three hundred archers at fifteen paces a
 * file are two hundred and forty paces from front to back, and a bow reaches
 * two hundred and thirty, so the rear ranks are shooting at nothing. Reach
 * divided by file spacing is how many ranks can see the target, and the same
 * fit against the simulation gives the constant.
 */
const MISSILE_REACH = 0.37;

/** Extra men caught by a shot that bursts, against an ordinary formation. */
function splashFactor(category: UnitCategory): number {
  return 1 + UNIT_STATS[category].splashRadius / 40;
}

/** Men of a missile arm who can actually see and reach the target. */
function shootersOf(category: UnitCategory, count: number, spacing: number): number {
  const ranks = UNIT_STATS[category].range / spacing;
  return Math.min(count, MISSILE_REACH * ranks * Math.sqrt(count));
}

/**
 * The width of the front two bodies share, in men.
 *
 * Bounded by the smaller of the two, because that is what a front is: the
 * larger body's surplus is standing behind its own line, doing nothing this
 * sum can count. Measured on total strength rather than fighting men, so a body
 * of archers still presents a front to the foot that reaches it.
 */
function frontageOf(ourStrength: number, theirStrength: number): number {
  if (ourStrength <= 0 || theirStrength <= 0) return 0;
  return MELEE_FRONT * Math.sqrt(Math.min(ourStrength, theirStrength));
}

/** Men of one arm on that front, given how far its weapon reaches. */
function meleeFightersOf(category: UnitCategory, front: number, share: number): number {
  return front * share * (UNIT_STATS[category].range / MELEE_BASE_REACH);
}

function countsOf(state: GameState, group: ArmyGroup): Map<UnitCategory, number> {
  const counts = new Map<UnitCategory, number>();
  for (const index of group.members) {
    const category = state.units.categoryOf(index);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return counts;
}

/**
 * The enemy as *known*: a rounded head count spread evenly over the arms that
 * have actually been seen. This is deliberately coarse. Reporting a precise
 * enemy order of battle here would hand a Marshal through the back door exactly
 * what the fog exists to withhold.
 */
function estimatedCounts(contacts: readonly EnemyContact[]): Map<UnitCategory, number> {
  const counts = new Map<UnitCategory, number>();
  for (const contact of contacts) {
    const arms = contact.composition.length === 0 ? (['infantry'] as UnitCategory[]) : contact.composition;
    const share = contact.estimatedStrength / arms.length;
    for (const category of arms) counts.set(category, (counts.get(category) ?? 0) + share);
  }
  return counts;
}

function totalOf(counts: Map<UnitCategory, number>): number {
  let total = 0;
  for (const count of counts.values()) total += count;
  return total;
}

function meleeTotalOf(counts: Map<UnitCategory, number>): number {
  let total = 0;
  for (const [category, count] of counts) {
    if (!isMissile(category) && UNIT_STATS[category].attack > 0) total += count;
  }
  return total;
}

function hitPointPool(counts: Map<UnitCategory, number>): number {
  let pool = 0;
  for (const [category, count] of counts) pool += count * UNIT_STATS[category].maxHitPoints;
  return pool;
}

/** Shares by category, in the canonical order so a tie always resolves alike. */
function sharesOf(counts: Map<UnitCategory, number>): Array<{ category: UnitCategory; share: number }> {
  const total = Math.max(1, totalOf(counts));
  return UNIT_CATEGORIES.filter((category) => (counts.get(category) ?? 0) > 0).map((category) => ({
    category,
    share: (counts.get(category) ?? 0) / total,
  }));
}

function round(value: number, places = 2): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

interface SideConditions {
  /** Ground the defender is standing on, and whether he is dug into it. */
  defenderTerrain: string;
  defenderHoldsGround: boolean;
  attackerOnHigherGround: boolean;
  /** Supplied only where the defender's formation is knowledge we have. */
  defenderProfile?: { antiCavalry: number; rangedVulnerability: number };
}

/**
 * What a body of men delivers per second into another, in hit points.
 *
 * `fighters` is how many of each arm are actually fighting — the frontage for
 * melee, the ranks in range for missiles — not how many are present.
 */
function damageInto(
  fighters: Map<UnitCategory, number>,
  defenderShares: Array<{ category: UnitCategory; share: number }>,
  conditions: SideConditions,
): number {
  let total = 0;
  for (const [category, count] of fighters) {
    if (count <= 0) continue;
    const missile = isMissile(category);
    let damage = count * rawDamagePerSecond(category) * splashFactor(category);

    let counter = 0;
    for (const target of defenderShares) counter += target.share * counterMultiplier(category, target.category);
    damage *= counter;

    if (conditions.defenderHoldsGround) {
      damage *= terrainDefenceModifier(conditions.defenderTerrain, missile, category === 'cavalry');
    }
    if (missile && conditions.attackerOnHigherGround) damage *= HIGH_GROUND_FIRE;

    const profile = conditions.defenderProfile;
    if (profile !== undefined) {
      if (missile) damage *= profile.rangedVulnerability;
      if (category === 'cavalry') damage /= profile.antiCavalry;
    }

    total += damage;
  }
  return total;
}

function verdictOf(advantage: number): EngagementVerdict {
  if (advantage >= 2.2) return 'decisive';
  if (advantage >= 1.25) return 'favourable';
  if (advantage >= 0.8) return 'even';
  if (advantage >= 0.5) return 'costly';
  return 'losing';
}

const VERDICT_PHRASE: Record<EngagementVerdict, string> = {
  decisive: 'You should break them and keep the regiment.',
  favourable: 'You win this, at a price worth paying.',
  even: 'This is a grinding, even fight. Something else has to decide it.',
  costly: 'You lose more than you take. Do not commit without an advantage of position.',
  losing: 'These men are destroyed. Do not send them.',
};

function notableMatchups(
  ours: Array<{ category: UnitCategory; share: number }>,
  theirs: Array<{ category: UnitCategory; share: number }>,
): Matchup[] {
  const matchups: Matchup[] = [];
  for (const mine of ours) {
    if (mine.share < 0.05) continue;
    for (const foe of theirs) {
      if (foe.share < 0.05) continue;
      const attacking = counterMultiplier(mine.category, foe.category);
      const receiving = counterMultiplier(foe.category, mine.category);
      if (attacking >= 1.3) {
        matchups.push({
          yours: mine.category,
          theirs: foe.category,
          multiplier: attacking,
          note: `Your ${mine.category} hit their ${foe.category} at ${attacking}×.`,
        });
      }
      if (receiving >= 1.3) {
        matchups.push({
          yours: mine.category,
          theirs: foe.category,
          multiplier: round(1 / receiving),
          note: `Their ${foe.category} hit your ${mine.category} at ${receiving}×. This is the matchup to avoid.`,
        });
      }
    }
  }
  return matchups
    .sort((a, b) => Math.abs(Math.log(b.multiplier)) - Math.abs(Math.log(a.multiplier)))
    .slice(0, 8);
}

export function assessEngagement(
  state: GameState,
  playerId: PlayerId,
  input: EngagementInput,
): EngagementAssessment {
  /* ------------------------------------------------- what we are attacking */

  const known = [...state.contacts[playerId].values()];
  let contacts: EnemyContact[];
  let targetKind: 'group' | 'zone';
  let targetName: string;
  let targetZone: ZoneId;

  if (input.targetGroupId !== undefined) {
    const contact = known.find((entry) => entry.groupId === input.targetGroupId);
    if (contact === undefined) {
      throw new AssessmentError(
        'NO_SUCH_CONTACT',
        `Nothing is known of any enemy force called "${input.targetGroupId}".`,
        ['Call get_intelligence for the contacts you have. Unscouted ground reports nothing.'],
      );
    }
    contacts = [contact];
    targetKind = 'group';
    targetName = contact.name;
    targetZone = contact.lastSeenZone;
  } else if (input.targetZone !== undefined) {
    contacts = known.filter((entry) => entry.lastSeenZone === input.targetZone);
    if (contacts.length === 0) {
      throw new AssessmentError(
        'NO_CONTACT_THERE',
        `No enemy force is known at ${ZONES[input.targetZone].name}.`,
        [
          'This is an absence of intelligence, not an absence of troops. Scout it first.',
          'Call get_intelligence for ground where an enemy has actually been seen.',
        ],
      );
    }
    targetKind = 'zone';
    targetName = ZONES[input.targetZone].name;
    targetZone = input.targetZone;
  } else {
    throw new AssessmentError('INVALID_INPUT', 'Give either a targetGroupId or a targetZone.', [
      'Call get_intelligence for enemy group ids, or get_strategic_zones for ground.',
    ]);
  }

  /* ----------------------------------------------------- who we are sending */

  const groups = input.groupIds.map((groupId) => {
    const group = findGroup(state, groupId);
    if (group === undefined || group.ownerId !== playerId || group.members.length === 0) {
      throw new AssessmentError('GROUP_NOT_FOUND', `No group named "${groupId}" under your command.`, [
        'Call get_armies for the ids you may command.',
      ]);
    }
    return group;
  });

  const zone = ZONES[targetZone];
  const terrain = terrainAt(zone.center.x, zone.center.y);
  const defenderCounts = estimatedCounts(contacts);
  const defenderShares = sharesOf(defenderCounts);

  /* -------------------------------------------------------- our own weight */

  // Two passes, because a melee has one front and both sides stand on it. The
  // frontage cannot be known until every regiment committed has been counted,
  // and it is what stops a big battalion from reading as a decisive one.
  const composition = groups.map((group) => ({ group, counts: countsOf(state, group) }));
  const ourCounts = new Map<UnitCategory, number>();
  for (const entry of composition) {
    for (const [category, count] of entry.counts) {
      ourCounts.set(category, (ourCounts.get(category) ?? 0) + count);
    }
  }

  const ourMeleeTotal = meleeTotalOf(ourCounts);
  const ourTotal = totalOf(ourCounts);
  const theirTotal = totalOf(defenderCounts);
  const front = frontageOf(ourTotal, theirTotal);

  const attackers: AttackerLine[] = [];
  let yourDamagePerSecond = 0;

  for (const { group, counts } of composition) {
    const profile = FORMATION_PROFILES[group.formation];
    const stance = STANCE_PROFILES[group.stance];
    const penalties: Record<string, number> = {};
    const warnings: string[] = [];

    // Everything that is costing this particular regiment, priced separately so
    // the Marshal can see what is arithmetic and what is a mistake it can fix.
    const moraleFactor = 0.6 + 0.4 * (group.morale / 100);
    const crowdingFactor = 1 - CROWDING.damagePenalty * group.crowding;
    const fatigueFactor = 1 - FATIGUE.damagePenalty * group.fatigue;
    if (moraleFactor < 0.99) penalties.morale = round(moraleFactor);
    if (crowdingFactor < 0.99) penalties.crowding = round(crowdingFactor);
    if (fatigueFactor < 0.99) penalties.fatigue = round(fatigueFactor);
    if (stance.damageModifier !== 1) penalties.stance = stance.damageModifier;

    // This regiment's share of the one front the whole attack is fighting on.
    const groupMelee = meleeTotalOf(counts);
    const groupFront = ourMeleeTotal > 0 ? front * (groupMelee / ourMeleeTotal) : 0;


    const fighters = new Map<UnitCategory, number>();
    for (const [category, count] of counts) {
      if (UNIT_STATS[category].attack <= 0) continue;

      if (!isMissile(category)) {
        // Melee men fight along the frontage, in proportion to their share of it.
        const share = groupMelee > 0 ? count / groupMelee : 0;
        fighters.set(category, meleeFightersOf(category, groupFront, share) * profile.meleeModifier);
        continue;
      }

      if (UNIT_STATS[category].deployTicks > 0 && group.path.length > 0) {
        warnings.push('Its guns are still limbered and will not fire until they have stood a while.');
        continue;
      }

      // A masked regiment is not a regiment: the flat-trajectory arms hold their
      // fire entirely rather than shoot through your own men.
      let weight = shootersOf(category, count, profile.spacing);
      if (group.blockedFire >= FIRE.reportThreshold) {
        if (UNIT_STATS[category].loft < FIRE.loftedTrajectory) {
          warnings.push(
            `Its ${UNIT_STATS[category].label.toLowerCase()} are masked and will not fire at all. ` +
              'Move them to a flank or onto high ground.',
          );
          continue;
        }
        warnings.push(
          `Its ${UNIT_STATS[category].label.toLowerCase()} are masked and loft over at reduced accuracy.`,
        );
      }
      weight *= 1 - group.blockedFire * FIRE.accuracyPenalty;
      fighters.set(category, weight * profile.rangedModifier);
    }

    let contribution = damageInto(fighters, defenderShares, {
      defenderTerrain: terrain,
      defenderHoldsGround: true,
      attackerOnHigherGround: false,
    });
    contribution *= stance.damageModifier * moraleFactor * crowdingFactor * fatigueFactor;

    if (group.routing) {
      warnings.push('It is routing. It will not fight until it has rallied.');
      contribution = 0;
    }
    if (!group.routing && group.engagement >= CONTACT.pinEngagement) {
      warnings.push('It is already held in contact and cannot march to a new fight.');
    }

    yourDamagePerSecond += contribution;
    attackers.push({
      groupId: group.id,
      name: group.name,
      strength: group.members.length,
      formation: group.formation,
      stance: group.stance,
      morale: Math.round(group.morale),
      damagePerSecond: round(contribution, 1),
      penalties,
      warnings,
    });
  }

  /* ------------------------------------------------------- their own weight */

  // Our formations are ours to know, so their protection is priced; the enemy's
  // is not, which is why nothing on the other side of this sum is assumed. They
  // stand on the same front we do, and their missile arms shoot from an
  // ordinary line because their arrangement is not knowledge we have.
  const ourShares = sharesOf(ourCounts);
  const theirMelee = meleeTotalOf(defenderCounts);
  const theirFighters = new Map<UnitCategory, number>();
  for (const [category, count] of defenderCounts) {
    if (UNIT_STATS[category].attack <= 0) continue;
    if (isMissile(category)) {
      theirFighters.set(category, shootersOf(category, count, FORMATION_PROFILES.line.spacing));
    } else if (theirMelee > 0) {
      theirFighters.set(category, meleeFightersOf(category, front, count / theirMelee));
    }
  }

  const leadFormation = FORMATION_PROFILES[groups[0]?.formation ?? 'line'];
  const leadStance = STANCE_PROFILES[groups[0]?.stance ?? 'defensive'];
  const theirDamagePerSecond =
    damageInto(theirFighters, ourShares, {
      defenderTerrain: terrain,
      defenderHoldsGround: false,
      attackerOnHigherGround: terrain === 'hill',
      defenderProfile: {
        antiCavalry: leadFormation.antiCavalry,
        rangedVulnerability: leadFormation.rangedVulnerability,
      },
    }) * leadStance.damageTakenModifier;

  const ourPool = hitPointPool(ourCounts);
  const theirPool = hitPointPool(defenderCounts);
  const secondsToBreakThem = yourDamagePerSecond > 0 ? theirPool / yourDamagePerSecond : Infinity;
  const secondsToBreakYou = theirDamagePerSecond > 0 ? ourPool / theirDamagePerSecond : Infinity;
  const advantage =
    secondsToBreakThem === Infinity
      ? 0
      : secondsToBreakYou === Infinity
        ? 99
        : secondsToBreakYou / secondsToBreakThem;
  const verdict = verdictOf(advantage);

  /* ------------------------------------------------------- what to do about it */

  const recommendations: string[] = [];
  const theirCategories = defenderShares.map((entry) => entry.category);
  const ourCategories = ourShares.filter((entry) => entry.share >= 0.05).map((entry) => entry.category);

  if (theirCategories.includes('cavalry') && leadFormation.antiCavalry < 1.2) {
    const haveSpears = ourCategories.includes('spearman');
    recommendations.push(
      haveSpears
        ? 'They have horse. Your spears answer it at 2.4×, but only if they are the men who meet the charge.'
        : 'They have horse and this formation does not brace. Form square, or bring spears up.',
    );
  }
  if (ourCategories.includes('cavalry') && theirCategories.includes('spearman')) {
    recommendations.push(
      'Do not put your horse into their spears: it is the worst matchup on the field. Send foot to fix them and take the wing instead.',
    );
  }
  if (theirCategories.includes('heavy_infantry') && !ourCategories.includes('handgunner')) {
    recommendations.push(
      'Their armour turns arrows. Shot goes through it at 1.7×; bring handgunners, or heavy foot of your own.',
    );
  }
  if (terrain === 'hill' || terrain === 'village' || terrain === 'forest') {
    recommendations.push(
      `They are standing in ${terrain}, which is worth ` +
        `${Math.round((1 - terrainDefenceModifier(terrain, false)) * 100)}% ` +
        'off everything you throw at them. Draw them off it, or bombard them where they stand.',
    );
  }
  if (zone.crossing) {
    recommendations.push(
      `${zone.name} is a crossing. Men fighting from it deliver ${CONTACT.assaultingCrossing}× their weight, ` +
        'so hold the far end rather than the bridge itself.',
    );
  }
  const acrossTheBarrier = groups.filter(
    (group) =>
      isBeyondBarrier(group.anchor.y, group.anchor.x) !== isBeyondBarrier(zone.center.y, zone.center.x),
  );
  if (acrossTheBarrier.length > 0 && !zone.crossing) {
    recommendations.push(
      `${acrossTheBarrier.map((group) => group.name).join(', ')} must cross to reach this. Men still on a ` +
        `crossing fight at ${CONTACT.assaultingCrossing}× against a formed line — this figure does not include that.`,
    );
  }
  if (verdict === 'losing' || verdict === 'costly') {
    recommendations.push(
      'On these numbers, position has to make the difference: take them in the flank (1.3×) or the rear (1.55×), ' +
        'or bring a second regiment onto another quarter.',
    );
  }
  if (advantage >= 1.25 && contacts.some((contact) => !contact.visibleNow)) {
    recommendations.push(
      'This contact is remembered, not seen. It may have moved, been reinforced, or be bait; confirm it before committing.',
    );
  }

  const staleness = contacts.reduce(
    (oldest, contact) => Math.max(oldest, state.currentTick - contact.lastSeenTick),
    0,
  );

  return {
    target: {
      kind: targetKind,
      name: targetName,
      zone: targetZone,
      zoneName: ZONES[targetZone].name,
      terrain,
      estimatedStrength: Math.round(totalOf(defenderCounts)),
      composition: [...new Set(defenderShares.map((entry) => entry.category))],
      visibleNow: contacts.some((contact) => contact.visibleNow),
      lastSeenSecondsAgo: Math.round(staleness / TICKS_PER_SECOND),
    },
    attackers,
    yourDamagePerSecond: round(yourDamagePerSecond, 1),
    theirDamagePerSecond: round(theirDamagePerSecond, 1),
    advantage: round(advantage),
    secondsToBreakThem: secondsToBreakThem === Infinity ? -1 : Math.round(secondsToBreakThem),
    secondsToBreakYou: secondsToBreakYou === Infinity ? -1 : Math.round(secondsToBreakYou),
    verdict,
    summary:
      `${groups.map((group) => group.name).join(', ')} against ${targetName} ` +
      `(~${Math.round(totalOf(defenderCounts))} men, ${defenderShares.map((entry) => entry.category).join('/')}) ` +
      `on ${terrain} ground: ${verdict}. ${VERDICT_PHRASE[verdict]}`,
    matchups: notableMatchups(ourShares, defenderShares),
    recommendations,
    assumptions: [
      'A frontal fight along one shared front. Only the men in contact fight, and only the ranks ' +
        'within reach shoot, so numbers alone do not win a melee — they win by lasting longer.',
      'No charge, no flank and no encirclement. Those are yours to arrange, and each is worth more ' +
        'than any advantage in this sum.',
      'Missile arms are counted as having a clear shot at the range they are engaged at. A battery ' +
        'caught in a melee is worth far less than this says; one left to shoot, rather more.',
      'Enemy strength is a rounded estimate and their arms are only those that have been seen.',
      'Their formation, stance, morale and exhaustion are not knowledge you have, and are left out rather than guessed.',
      'A formation usually breaks and runs well before it is destroyed, so both times to break are ceilings.',
    ],
  };
}
