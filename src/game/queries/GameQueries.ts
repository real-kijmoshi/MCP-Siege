import {
  CONTACT,
  CROWDING,
  FATIGUE,
  FIELD_SUPPORT,
  FORMATION_PROFILES,
  OBJECTIVE,
  TICKS_PER_SECOND,
  UNIT_STATS,
} from '../config/battle';
import { DIFFICULTIES } from '../config/matches';
import { SCENARIOS } from '../config/scenario';
import { describeCondition } from '../simulation/Conditions';
import { activeGroups, findGroup, type GameState } from '../simulation/GameState';
import { ZONES, activeZones, useBattleMap, zoneAt } from '../simulation/Zones';
import { visibilityAt } from '../simulation/Visibility';
import {
  FRONTS,
  UNIT_CATEGORIES,
  opponentOf,
  type ArmyGroup,
  type BattleOutcome,
  type BattleAlert,
  type Front,
  type MoraleState,
  type PlanStep,
  type PlayerId,
  type UnitCategory,
  type ZoneId,
} from '../types/domain';

/**
 * Visibility-safe projections.
 *
 * Everything the external Marshal can read comes through here, and every
 * enemy-facing figure is derived from that side's own contacts rather than from
 * the truth. The projections are deliberately strategic: group summaries and
 * front assessments, never a dump of thousands of soldiers.
 */

export class QueryError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'QueryError';
  }
}

export type FrontStatus =
  | 'player_advantage'
  | 'enemy_advantage'
  | 'heavy_engagement'
  | 'contested'
  | 'no_contact'
  | 'unobserved'
  | 'quiet';

export interface ArmySummary {
  id: string;
  name: string;
  strength: number;
  strengthPercent: number;
  formation: string;
  stance: string;
  morale: number;
  moraleState: MoraleState;
  activity: string;
  orderKind: string;
  targetZone?: ZoneId;
  targetGroupId?: string;
  zone: ZoneId;
  zoneName: string;
  front: Front;
  composition: Record<string, number>;
  /**
   * The troop type most of these men carry.
   *
   * The counter matrix decides most fights, so "is that regiment spears or
   * bows" is the single most load-bearing fact about it. Reporting it up front
   * lets the roster label it and the Marshal weigh a matchup without having to
   * unpick the composition map first.
   */
  primaryRole: UnitCategory;
  /** True while this group has taken casualties in the last few seconds. */
  engaged: boolean;
  /**
   * True when the attack is coming from more quarters than a formation can
   * face at once. Being surrounded is now the fastest way a regiment is
   * destroyed, so a commander who cannot see it happening cannot answer it.
   */
  surrounded: boolean;
  /**
   * True when the group is held in contact and can no longer march off. Read
   * one way it is a warning; read the other it is confirmation that a blocking
   * position is doing its job.
   */
  pinned: boolean;
  /**
   * True when the men are packed too tightly to fight properly, which happens
   * when several regiments are pushed onto the same ground or through the same
   * defile. A crushed formation loses much of its damage, bleeds morale, and
   * is worth twice as much to enemy archers. The answer is space: send fewer
   * regiments through at once, or spread into loose order.
   */
  crowded: boolean;
  /**
   * How spent the regiment is, 0 fresh to 100 exhausted. Troops that have been
   * fighting for a long time hit softer and give ground more easily, which is
   * what makes relieving a tired regiment with a fresh one worth doing.
   */
  fatigue: number;
  /** True once fatigue has reached the point where it is costing the group. */
  spent: boolean;
  /**
   * True while the group is carrying guns that are still on their teams and
   * therefore cannot fire.
   *
   * A battery on the march is not a weapon, it is baggage, and the one mistake
   * everybody makes with artillery is walking it forward with the advance and
   * wondering why it never shoots. Reported rather than inferred, because
   * nothing else the commander can see would tell him.
   */
  limbered: boolean;
  /**
   * True while a field hospital within reach is tending this regiment.
   *
   * Only ever true out of contact: care stops the moment the fighting reaches
   * it. This is the readout that makes withdrawing a battered regiment legible
   * as a move rather than a retreat.
   */
  tended: boolean;
}

export interface ArmyDetails extends ArmySummary {
  initialStrength: number;
  casualties: number;
  formationEffect: string;
  position: { x: number; y: number };
  order: {
    kind: string;
    targetZone?: ZoneId;
    targetGroupId?: string;
    issuedSecondsAgo: number;
  };
  routing: boolean;
  nearbyFriendly: string[];
  knownThreats: string[];
}

export interface EnemyContactView {
  groupId: string;
  name: string;
  estimatedStrength: number;
  composition: UnitCategory[];
  zone: ZoneId;
  zoneName: string;
  front: Front;
  visibleNow: boolean;
  lastSeenSecondsAgo: number;
}

export interface BattleOverview {
  tick: number;
  elapsedSeconds: number;
  playerStrength: number;
  playerUnits: number;
  enemyVisibleStrength: number;
  armyCount: number;
  fronts: Record<Front, FrontStatus>;
  alerts: string[];
  reinforcementsReady: number;
  planStatus: string;
  objective: ObjectiveSummary;
  intelligence: {
    visibleEnemyGroups: number;
    rememberedEnemyGroups: number;
    note: string;
  };
  attention: string[];
  nextActions: string[];
  operation: {
    id: string;
    name: string;
    briefing: string;
    difficulty: string;
  };
}

export type KingStatus = 'safe' | 'threatened' | 'besieged' | 'captured';

/** One line each, for the tool that a Marshal reads first. */
export interface ObjectiveSummary {
  goal: string;
  yourKing: string;
  enemyKing: string;
  outcome: BattleOutcome;
}

export interface OwnKingReport {
  name: string;
  status: KingStatus;
  capturePercent: number;
  /** Men of the Royal Guard still standing over him. */
  guardStrength: number;
  defenders: number;
  attackers: number;
  zone: ZoneId;
  zoneName: string;
}

/**
 * The enemy sovereign as *known*, not as he is.
 *
 * There is no live position here: only where he was last actually seen. Capture
 * progress is reported only while your own men are in the ring around him,
 * which is the one circumstance in which you would in fact know it.
 */
export interface EnemyKingReport {
  name: string;
  visibleNow: boolean;
  lastSeenZone?: ZoneId;
  lastSeenZoneName?: string;
  lastSeenSecondsAgo?: number;
  capturePercent: number;
  note: string;
}

export interface ObjectiveReport {
  goal: string;
  outcome: BattleOutcome;
  outcomeReason: string;
  captureRadius: number;
  yourKing: OwnKingReport;
  enemyKing: EnemyKingReport;
  result: {
    elapsedSeconds: number;
    initialUnits: number;
    survivingUnits: number;
    losses: number;
    survivingRegiments: number;
  };
}

export interface FrontReport {
  front: Front;
  status: FrontStatus;
  playerStrength: number;
  enemyKnownStrength: number;
  playerGroups: string[];
  enemyContacts: string[];
  zones: Array<{ zone: ZoneId; name: string; control: string }>;
}

export interface ZoneReport {
  id: ZoneId;
  name: string;
  terrain: string;
  front: Front;
  control: 'player' | 'enemy' | 'contested' | 'unknown';
  description: string;
  crossing: boolean;
}

export interface ActiveOrdersReport {
  groups: Array<{
    groupId: string;
    name: string;
    order: string;
    orderKind: string;
    targetZone?: ZoneId;
    targetGroupId?: string;
    /** Count only: waypoint coordinates remain inside the simulation boundary. */
    waypointsRemaining: number;
    secondsAgo: number;
  }>;
  conditionalOrders: Array<{
    id: string;
    groupId: string;
    action: string;
    trigger: string;
    note: string;
    fromPlan?: string;
  }>;
}

export interface PlanReport {
  id: string;
  name: string;
  status: string;
  createdSecondsAgo: number;
  steps: Array<{
    id: string;
    index: number;
    groupId: string;
    groupName: string;
    action: string;
    target: string;
    trigger: string;
    note: string;
  }>;
}

/* -------------------------------------------------------------------- utils */

/** How long after a casualty a group still reads as "in contact". */
const ENGAGED_TICKS = TICKS_PER_SECOND * 3;

function strengthOf(state: GameState, group: ArmyGroup): number {
  let total = 0;
  for (const index of group.members) {
    total += UNIT_STATS[state.units.categoryOf(index)].strengthValue;
  }
  return Math.round(total);
}

/**
 * Whether a group's guns are still on the move and so cannot fire.
 *
 * Read from the anchor rather than from the pieces themselves: a battery is
 * unlimbered as a body, and asking every gun would be a pass over the pool for
 * a line of roster text. A group with no guns in it is never limbered.
 */
function isLimbered(state: GameState, group: ArmyGroup): boolean {
  if (group.path.length === 0 && !group.routing) return false;
  return group.members.some((index) => UNIT_STATS[state.units.categoryOf(index)].deployTicks > 0);
}

/** The category the largest share of a group's men belong to. */
function primaryRoleOf(state: GameState, group: ArmyGroup): UnitCategory {
  const counts = new Map<UnitCategory, number>();
  for (const index of group.members) {
    const category = state.units.categoryOf(index);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  // Canonical order, not map order, so a tie always resolves the same way.
  let best: UnitCategory = 'infantry';
  let bestCount = -1;
  for (const category of UNIT_CATEGORIES) {
    const count = counts.get(category) ?? 0;
    if (count > bestCount) {
      bestCount = count;
      best = category;
    }
  }
  return best;
}

function compositionOf(state: GameState, group: ArmyGroup): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const index of group.members) {
    const label = UNIT_STATS[state.units.categoryOf(index)].label;
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return counts;
}

function activityOf(group: ArmyGroup): string {
  if (group.routing) return 'Routing';
  const zone = group.order.targetZone;
  const target = zone === undefined ? undefined : ZONES[zone].name;
  switch (group.order.kind) {
    case 'idle':
      return 'Idle';
    case 'move':
      return target === undefined ? 'Advancing' : `Advancing to ${target}`;
    case 'attack_zone':
      return target === undefined ? 'Attacking' : `Attacking ${target}`;
    case 'attack_group':
      return `Attacking ${group.order.targetGroupId ?? 'enemy'}`;
    case 'defend_zone':
      return target === undefined ? 'Defending' : `Defending ${target}`;
    case 'hold':
      return 'Holding position';
    case 'retreat':
      return 'Withdrawing';
    case 'scout':
      return target === undefined ? 'Scouting' : `Scouting ${target}`;
    case 'support':
      return `Supporting ${group.order.targetGroupId ?? 'the line'}`;
  }
}

function frontOf(group: ArmyGroup): Front {
  return ZONES[zoneAt(group.anchor.x, group.anchor.y)].front;
}

export class GameQueries {
  public constructor(private readonly stateProvider: () => GameState) {}

  /**
   * Every read starts here, and every read starts by pointing the geography at
   * the map this battle is actually being fought on. Without it a second engine
   * on a second map could answer a question with the wrong ground.
   */
  private state(): GameState {
    const state = this.stateProvider();
    useBattleMap(state.mapId);
    return state;
  }

  private seconds(ticks: number): number {
    return Math.round(ticks / TICKS_PER_SECOND);
  }

  /* ------------------------------------------------------------- armies */

  public getArmies(playerId: PlayerId): ArmySummary[] {
    const state = this.state();
    return activeGroups(state, playerId).map((group) => this.summarise(state, group));
  }

  private summarise(state: GameState, group: ArmyGroup): ArmySummary {
    const zone = zoneAt(group.anchor.x, group.anchor.y);
    const summary: ArmySummary = {
      id: group.id,
      name: group.name,
      strength: group.members.length,
      strengthPercent: Math.round((group.members.length / Math.max(1, group.initialStrength)) * 100),
      formation: group.formation,
      stance: group.stance,
      morale: Math.round(group.morale),
      moraleState: group.moraleState,
      activity: activityOf(group),
      orderKind: group.order.kind,
      zone,
      zoneName: ZONES[zone].name,
      front: ZONES[zone].front,
      composition: compositionOf(state, group),
      primaryRole: primaryRoleOf(state, group),
      engaged:
        group.lastCasualtyTick >= 0 &&
        state.currentTick - group.lastCasualtyTick < ENGAGED_TICKS,
      surrounded: group.encirclement > 0,
      pinned: !group.routing && group.engagement >= CONTACT.pinEngagement,
      crowded: group.crowding >= CROWDING.reportThreshold,
      fatigue: Math.round(group.fatigue * 100),
      spent: group.fatigue >= FATIGUE.reportThreshold,
      limbered: isLimbered(state, group),
      tended: group.succour >= FIELD_SUPPORT.reportThreshold,
    };
    if (group.order.targetZone !== undefined) summary.targetZone = group.order.targetZone;
    if (group.order.targetGroupId !== undefined) summary.targetGroupId = group.order.targetGroupId;
    return summary;
  }

  public getArmyDetails(playerId: PlayerId, groupId: string): ArmyDetails {
    const state = this.state();
    const group = findGroup(state, groupId);

    if (group === undefined || group.ownerId !== playerId || group.members.length === 0) {
      throw new QueryError('GROUP_NOT_FOUND', `No group named "${groupId}" under your command.`);
    }

    const nearbyFriendly = activeGroups(state, playerId)
      .filter((other) => {
        if (other.id === group.id) return false;
        const dx = other.anchor.x - group.anchor.x;
        const dy = other.anchor.y - group.anchor.y;
        return dx * dx + dy * dy < 900 * 900;
      })
      .map((other) => other.name);

    // Threats are drawn from intelligence, so an unseen army is not listed.
    const knownThreats = [...state.contacts[playerId].values()]
      .filter((contact) => {
        const dx = contact.lastPosition.x - group.anchor.x;
        const dy = contact.lastPosition.y - group.anchor.y;
        return dx * dx + dy * dy < 1200 * 1200;
      })
      .map(
        (contact) =>
          `${contact.name} (~${contact.estimatedStrength}, ${contact.composition.join('/')})`,
      );

    const order: ArmyDetails['order'] = {
      kind: group.order.kind,
      issuedSecondsAgo: this.seconds(state.currentTick - group.order.issuedAtTick),
    };
    if (group.order.targetZone !== undefined) order.targetZone = group.order.targetZone;
    if (group.order.targetGroupId !== undefined) order.targetGroupId = group.order.targetGroupId;

    return {
      ...this.summarise(state, group),
      initialStrength: group.initialStrength,
      casualties: Math.max(0, group.initialStrength - group.members.length),
      formationEffect: FORMATION_PROFILES[group.formation].description,
      position: { x: Math.round(group.anchor.x), y: Math.round(group.anchor.y) },
      order,
      routing: group.routing,
      nearbyFriendly,
      knownThreats,
    };
  }

  /* ------------------------------------------------------- intelligence */

  public getIntelligence(playerId: PlayerId): EnemyContactView[] {
    const state = this.state();
    return [...state.contacts[playerId].values()]
      .map((contact) => ({
        groupId: contact.groupId,
        name: contact.name,
        estimatedStrength: contact.estimatedStrength,
        composition: contact.composition,
        zone: contact.lastSeenZone,
        zoneName: ZONES[contact.lastSeenZone].name,
        front: ZONES[contact.lastSeenZone].front,
        visibleNow: contact.visibleNow,
        lastSeenSecondsAgo: this.seconds(state.currentTick - contact.lastSeenTick),
      }))
      .sort((a, b) => a.groupId.localeCompare(b.groupId));
  }

  public getVisibleEnemies(playerId: PlayerId): EnemyContactView[] {
    return this.getIntelligence(playerId).filter((contact) => contact.visibleNow);
  }

  /* -------------------------------------------------------------- fronts */

  public getFrontStatus(playerId: PlayerId): FrontReport[] {
    const state = this.state();
    const contacts = this.getIntelligence(playerId);

    return FRONTS.map((front) => {
      const groups = activeGroups(state, playerId).filter((group) => frontOf(group) === front);
      const playerStrength = groups.reduce((sum, group) => sum + strengthOf(state, group), 0);

      const frontContacts = contacts.filter((contact) => contact.front === front);
      const enemyKnownStrength = frontContacts.reduce(
        (sum, contact) => sum + contact.estimatedStrength,
        0,
      );

      // "Heavy engagement" means troops are actually taking losses here, not
      // merely that both sides are present.
      const engaged = groups.some(
        (group) => state.currentTick - group.lastCasualtyTick < TICKS_PER_SECOND * 8,
      );

      const frontZones = activeZones().filter((zone) => zone.front === front);
      const observed = frontZones.some(
        (zone) => visibilityAt(state, playerId, zone.center.x, zone.center.y) > 0,
      );

      let status: FrontStatus;
      if (!observed && frontContacts.length === 0) status = 'unobserved';
      else if (playerStrength === 0 && enemyKnownStrength === 0) status = 'quiet';
      else if (engaged) status = 'heavy_engagement';
      // No contact is not an advantage. Calling an unseen enemy absent made the
      // opening overview confidently tell a Marshal that every front was won.
      else if (enemyKnownStrength === 0) status = 'no_contact';
      else if (playerStrength > enemyKnownStrength * 1.35) status = 'player_advantage';
      else if (enemyKnownStrength > playerStrength * 1.35) status = 'enemy_advantage';
      else status = 'contested';

      return {
        front,
        status,
        playerStrength,
        enemyKnownStrength,
        playerGroups: groups.map((group) => group.name),
        enemyContacts: frontContacts.map(
          (contact) => `${contact.name} (~${contact.estimatedStrength})`,
        ),
        zones: activeZones()
          .filter((zone) => zone.front === front)
          .map((zone) => ({
            zone: zone.id,
            name: zone.name,
            control: this.describeControl(state, playerId, zone.id),
          })),
      };
    });
  }

  private describeControl(
    state: GameState,
    playerId: PlayerId,
    zoneId: ZoneId,
  ): 'player' | 'enemy' | 'contested' | 'unknown' {
    const zone = ZONES[zoneId];
    // Control of ground never seen is not knowledge the player has.
    if (visibilityAt(state, playerId, zone.center.x, zone.center.y) === 0) return 'unknown';
    const controller = state.zoneControl.get(zoneId);
    if (controller === undefined) return 'contested';
    return controller === playerId ? 'player' : 'enemy';
  }

  public getStrategicZones(playerId: PlayerId): ZoneReport[] {
    const state = this.state();
    return activeZones().map((zone) => ({
      id: zone.id,
      name: zone.name,
      terrain: zone.terrain,
      front: zone.front,
      control: this.describeControl(state, playerId, zone.id),
      description: zone.description,
      crossing: zone.crossing,
    }));
  }

  /* -------------------------------------------------------------- alerts */

  public getAlerts(playerId: PlayerId, limit = 12): BattleAlert[] {
    void playerId;
    const state = this.state();
    return state.alerts.slice(-limit).reverse();
  }

  /* ----------------------------------------------------------- objective */

  private kingStatusOf(king: { captured: boolean; besieged: boolean; captureProgress: number }): KingStatus {
    if (king.captured) return 'captured';
    if (king.besieged) return 'besieged';
    return king.captureProgress > 0 ? 'threatened' : 'safe';
  }

  public getObjective(playerId: PlayerId): ObjectiveReport {
    const state = this.state();
    const own = state.objective.kings[playerId];
    const foe = state.objective.kings[opponentOf(playerId)];
    const ownGroups = activeGroups(state, playerId);
    const survivingUnits = ownGroups.reduce((sum, group) => sum + group.members.length, 0);
    const initialUnits = state.objective.initialStrength[playerId];

    const ownZone = zoneAt(own.position.x, own.position.y);
    const sighting = foe.lastSightingByOpponent;
    // "Now" is generous by a few ticks because sightings are only refreshed on
    // the objective interval, not every frame.
    const visibleNow =
      sighting !== undefined && state.currentTick - sighting.tick <= OBJECTIVE.interval * 2;

    const enemyKing: EnemyKingReport = {
      name: foe.name,
      visibleNow,
      // Your own men are what fill this bar, so it is yours to know.
      capturePercent: foe.attackers > 0 ? Math.round(foe.captureProgress) : 0,
      note:
        sighting === undefined
          ? 'Never sighted. His standard has not been seen; scout the enemy rear.'
          : visibleNow
            ? 'In sight.'
            : 'Last known position only. He may have moved.',
    };
    if (sighting !== undefined) {
      enemyKing.lastSeenZone = sighting.zoneId;
      enemyKing.lastSeenZoneName = ZONES[sighting.zoneId].name;
      enemyKing.lastSeenSecondsAgo = this.seconds(state.currentTick - sighting.tick);
    }

    return {
      goal:
        `Take ${foe.name} by holding the ground around him, or break the ${this.getOpponentName(playerId)} ` +
        'entirely. Losing your own king loses the battle.',
      outcome: state.objective.outcome,
      outcomeReason: state.objective.outcomeReason,
      captureRadius: OBJECTIVE.captureRadius,
      result: {
        elapsedSeconds: this.seconds(state.currentTick),
        initialUnits,
        survivingUnits,
        losses: Math.max(0, initialUnits - survivingUnits),
        survivingRegiments: ownGroups.length,
      },
      yourKing: {
        name: own.name,
        status: this.kingStatusOf(own),
        capturePercent: Math.round(own.captureProgress),
        guardStrength: own.guardStrength,
        defenders: own.defenders,
        attackers: own.attackers,
        zone: ownZone,
        zoneName: ZONES[ownZone].name,
      },
      enemyKing,
    };
  }

  private summariseObjective(report: ObjectiveReport): ObjectiveSummary {
    const own = report.yourKing;
    const foe = report.enemyKing;
    return {
      goal: report.goal,
      yourKing:
        own.status === 'safe'
          ? `${own.name} is safe (guard ${own.guardStrength}).`
          : `${own.name} is ${own.status} — ${own.capturePercent}% taken, guard ${own.guardStrength}.`,
      enemyKing: foe.visibleNow
        ? `${foe.name} in sight at ${foe.lastSeenZoneName ?? 'unknown ground'} (${foe.capturePercent}% taken).`
        : foe.lastSeenZoneName === undefined
          ? `${foe.name} has never been sighted.`
          : `${foe.name} last seen at ${foe.lastSeenZoneName}, ${foe.lastSeenSecondsAgo}s ago.`,
      outcome: report.outcome,
    };
  }

  /* ------------------------------------------------------------ overview */

  public getBattleOverview(playerId: PlayerId): BattleOverview {
    const state = this.state();
    const groups = activeGroups(state, playerId);
    const playerStrength = groups.reduce((sum, group) => sum + strengthOf(state, group), 0);
    const playerUnits = groups.reduce((sum, group) => sum + group.members.length, 0);

    const contacts = [...state.contacts[playerId].values()];
    const visibleContacts = contacts.filter((contact) => contact.visibleNow);
    const enemyVisibleStrength = visibleContacts.reduce(
      (sum, contact) => sum + contact.estimatedStrength,
      0,
    );

    const fronts = {} as Record<Front, FrontStatus>;
    for (const report of this.getFrontStatus(playerId)) fronts[report.front] = report.status;

    const plan = this.currentPlan(state);

    const attention: string[] = [];
    const ownKing = state.objective.kings[playerId];
    if (ownKing.besieged) attention.push(`${ownKing.name} is under capture pressure.`);
    for (const group of groups) {
      if (group.routing) attention.push(`${group.name} is routing.`);
      else if (group.encirclement > 0) attention.push(`${group.name} is being surrounded.`);
      else if (group.morale < 35) attention.push(`${group.name} is close to breaking.`);
      else if (group.crowding >= CROWDING.reportThreshold) {
        attention.push(`${group.name} is packed too tightly to fight; give it room.`);
      } else if (group.fatigue >= FATIGUE.reportThreshold) {
        attention.push(`${group.name} is spent and should be relieved.`);
      }
    }
    if (visibleContacts.length === 0) {
      attention.push('No enemy formation is in sight; do not treat an empty report as an empty front.');
    }

    const nextActions =
      visibleContacts.length === 0
        ? [
            'Call get_armies for commandable group ids.',
            'Call get_strategic_zones, then order scouts toward decisive ground.',
          ]
        : [
            'Call get_front_status to compare committed strength by front.',
            'Call get_armies before issuing or revising orders.',
          ];

    return {
      tick: state.currentTick,
      elapsedSeconds: this.seconds(state.currentTick),
      playerStrength,
      playerUnits,
      enemyVisibleStrength,
      armyCount: groups.length,
      fronts,
      alerts: this.getAlerts(playerId, 6).map((alert) => alert.message),
      reinforcementsReady: state.players[playerId].availableWaves,
      planStatus:
        plan === undefined ? 'no active plan' : `${plan.name} (${plan.status})`,
      objective: this.summariseObjective(this.getObjective(playerId)),
      intelligence: {
        visibleEnemyGroups: visibleContacts.length,
        rememberedEnemyGroups: contacts.length - visibleContacts.length,
        note:
          contacts.length === 0
            ? 'No enemy has been sighted yet. Unknown forces are omitted by fog of war.'
            : 'Remembered contacts are last-known positions and may have moved.',
      },
      attention: attention.slice(0, 6),
      nextActions,
      operation: {
        id: state.scenarioId,
        name: SCENARIOS[state.scenarioId].name,
        briefing: SCENARIOS[state.scenarioId].objective,
        difficulty: DIFFICULTIES[state.difficultyId].name,
      },
    };
  }

  /* -------------------------------------------------------------- orders */

  public getActiveOrders(playerId: PlayerId): ActiveOrdersReport {
    const state = this.state();
    return {
      groups: activeGroups(state, playerId).map((group) => {
        const order: ActiveOrdersReport['groups'][number] = {
          groupId: group.id,
          name: group.name,
          order: activityOf(group),
          orderKind: group.order.kind,
          waypointsRemaining: group.path.length,
          secondsAgo: this.seconds(state.currentTick - group.order.issuedAtTick),
        };
        if (group.order.targetZone !== undefined) order.targetZone = group.order.targetZone;
        if (group.order.targetGroupId !== undefined) order.targetGroupId = group.order.targetGroupId;
        return order;
      }),
      conditionalOrders: state.conditionals
        .filter((pending) => findGroup(state, pending.groupId)?.ownerId === playerId)
        .map((pending) => ({
          id: pending.id,
          groupId: pending.groupId,
          action: pending.action,
          trigger: describeCondition(pending.condition),
          note: pending.note,
          ...(pending.planId !== undefined ? { fromPlan: pending.planId } : {}),
        })),
    };
  }

  /* --------------------------------------------------------------- plans */

  private currentPlan(state: GameState) {
    // The draft under discussion wins; otherwise show what is running.
    return (
      [...state.plans].reverse().find((plan) => plan.status === 'draft') ??
      [...state.plans].reverse().find((plan) => plan.status === 'executing')
    );
  }

  public getCurrentPlan(playerId: PlayerId): PlanReport | undefined {
    void playerId;
    const state = this.state();
    const plan = this.currentPlan(state);
    if (plan === undefined) return undefined;

    const describeTarget = (step: PlanStep): string => {
      if (step.targetZone !== undefined) return ZONES[step.targetZone].name;
      if (step.targetGroupId !== undefined) return step.targetGroupId;
      if (step.formation !== undefined) return `${step.formation} formation`;
      return '—';
    };

    return {
      id: plan.id,
      name: plan.name,
      status: plan.status,
      createdSecondsAgo: this.seconds(state.currentTick - plan.createdAtTick),
      steps: plan.steps.map((step) => ({
        id: step.id,
        index: step.index,
        groupId: step.groupId,
        groupName: findGroup(state, step.groupId)?.name ?? step.groupId,
        action: step.action,
        target: describeTarget(step),
        trigger: describeCondition(step.startCondition),
        note: step.note,
      })),
    };
  }

  /** The raw plan record, for the battlefield overlay. */
  public getPlanForOverlay(playerId: PlayerId) {
    void playerId;
    return this.currentPlan(this.state());
  }

  /* --------------------------------------------------------------- misc */

  public getOpponentName(playerId: PlayerId): string {
    return this.state().players[opponentOf(playerId)].name;
  }
}
