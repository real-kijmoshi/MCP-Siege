import { FORMATION_PROFILES, TICKS_PER_SECOND, UNIT_STATS } from '../config/battle';
import { describeCondition } from '../simulation/Conditions';
import { activeGroups, findGroup, type GameState } from '../simulation/GameState';
import { ORDERED_ZONES, ZONES, zoneAt } from '../simulation/Zones';
import { visibilityAt } from '../simulation/Visibility';
import {
  FRONTS,
  opponentOf,
  type ArmyGroup,
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
  zone: ZoneId;
  zoneName: string;
  front: Front;
  composition: Record<string, number>;
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
  groups: Array<{ groupId: string; name: string; order: string; secondsAgo: number }>;
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

function strengthOf(state: GameState, group: ArmyGroup): number {
  let total = 0;
  for (const index of group.members) {
    total += UNIT_STATS[state.units.categoryOf(index)].strengthValue;
  }
  return Math.round(total);
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

  private state(): GameState {
    return this.stateProvider();
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
    return {
      id: group.id,
      name: group.name,
      strength: group.members.length,
      strengthPercent: Math.round((group.members.length / Math.max(1, group.initialStrength)) * 100),
      formation: group.formation,
      stance: group.stance,
      morale: Math.round(group.morale),
      moraleState: group.moraleState,
      activity: activityOf(group),
      zone,
      zoneName: ZONES[zone].name,
      front: ZONES[zone].front,
      composition: compositionOf(state, group),
    };
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

      let status: FrontStatus;
      if (playerStrength === 0 && enemyKnownStrength === 0) status = 'quiet';
      else if (engaged) status = 'heavy_engagement';
      else if (enemyKnownStrength === 0) status = 'player_advantage';
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
        zones: ORDERED_ZONES.filter((zone) => zone.front === front).map((zone) => ({
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
    return ORDERED_ZONES.map((zone) => ({
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

  /* ------------------------------------------------------------ overview */

  public getBattleOverview(playerId: PlayerId): BattleOverview {
    const state = this.state();
    const groups = activeGroups(state, playerId);
    const playerStrength = groups.reduce((sum, group) => sum + strengthOf(state, group), 0);
    const playerUnits = groups.reduce((sum, group) => sum + group.members.length, 0);

    const enemyVisibleStrength = [...state.contacts[playerId].values()]
      .filter((contact) => contact.visibleNow)
      .reduce((sum, contact) => sum + contact.estimatedStrength, 0);

    const fronts = {} as Record<Front, FrontStatus>;
    for (const report of this.getFrontStatus(playerId)) fronts[report.front] = report.status;

    const plan = this.currentPlan(state);

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
    };
  }

  /* -------------------------------------------------------------- orders */

  public getActiveOrders(playerId: PlayerId): ActiveOrdersReport {
    const state = this.state();
    return {
      groups: activeGroups(state, playerId).map((group) => ({
        groupId: group.id,
        name: group.name,
        order: activityOf(group),
        secondsAgo: this.seconds(state.currentTick - group.order.issuedAtTick),
      })),
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
