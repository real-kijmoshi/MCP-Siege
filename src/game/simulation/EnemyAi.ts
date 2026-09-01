import { TICKS_PER_SECOND } from '../config/battle';
import { DIFFICULTIES, type ScriptedAiOrder } from '../config/matches';
import { getScenarioDefinition } from '../config/scenario';
import type { GameCommandPayload, OrderGroupsPayload } from '../commands/types';
import type { ArmyGroup, ZoneId } from '../types/domain';
import { raiseAlert } from './Alerts';
import { activeGroups, findGroup, type GameState } from './GameState';
import { ZONES, activeZoneIds, homeZoneOf, zoneAt } from './Zones';

/**
 * The opposing commander.
 *
 * A scripted escalation gives the scenario its shape, and a light reactive
 * layer keeps it from feeling like a cutscene. Everything it does is submitted
 * as an ordinary command, so the enemy plays by exactly the same rules.
 */

/** The guard is seated with its king on the opening tick and does not leave. */
function guardOrder(): ScriptedAiOrder {
  return {
    atSeconds: 1,
    groupId: 'ashen_guard',
    order: 'defend_zone',
    targetZone: homeZoneOf('enemy').id,
    formation: 'square',
    stance: 'hold_ground',
  };
}

function scriptedThisTick(state: GameState): GameCommandPayload[] {
  const commands: GameCommandPayload[] = [];
  const difficulty = DIFFICULTIES[state.difficultyId];
  const script = getScenarioDefinition(state.scenarioId).aiScript;
  for (const entry of [guardOrder(), ...script]) {
    // Fires on exactly the tick it comes due, so the script never repeats.
    const dueTick = Math.round(entry.atSeconds * difficulty.timelineScale * TICKS_PER_SECOND);
    if (state.currentTick !== dueTick) continue;
    const group = findGroup(state, entry.groupId);
    if (group === undefined || group.members.length === 0) continue;

    const payload: OrderGroupsPayload = {
      type: 'order_groups',
      playerId: 'enemy',
      groupIds: [entry.groupId],
      order: entry.order,
    };
    if (entry.targetZone !== undefined) payload.targetZone = entry.targetZone;
    if (entry.formation !== undefined) payload.formation = entry.formation;
    if (entry.stance !== undefined) payload.stance = entry.stance;
    commands.push(payload);
  }
  return commands;
}

/**
 * Whether a regiment is free to be given something new to do.
 *
 * Being "idle" is not enough. A group that was sent to storm a bridge keeps
 * `attack_zone` as its order for the rest of the battle, so once its assault
 * ended it was never considered again — which is precisely why an untouched
 * battle used to grind to a halt at half strength and simply stay there. A
 * group that has arrived, has no waypoints left, and is not currently in
 * contact has finished its orders whatever they nominally still say.
 */
function hasFinishedItsOrders(state: GameState, group: ArmyGroup): boolean {
  if (group.order.kind === 'idle' || group.order.kind === 'hold') return true;
  if (group.path.length > 0) return false;
  // Still fighting where it was sent: leave it alone.
  if (
    group.lastCasualtyTick >= 0 &&
    state.currentTick - group.lastCasualtyTick < TICKS_PER_SECOND * 6
  ) {
    return false;
  }
  // And give every order a moment to take effect before reconsidering it.
  return state.currentTick - group.order.issuedAtTick > TICKS_PER_SECOND * 8;
}

/** Regiments the commander will not redirect, whatever the situation. */
function isCommitted(state: GameState, group: ArmyGroup): boolean {
  if (group.routing) return true;
  if (group.id === state.objective.kings.enemy.guardGroupId) return true;
  // Siege is committed by the script alone; it must not wander into a melee.
  return group.members.some((index) => state.units.categoryOf(index) === 'siege');
}

/**
 * Sighted player strength by zone. Module-level scratch, fully rebuilt by
 * `refreshSighting` before every read, so reading the whole contact book costs
 * no allocation per evaluation and nothing carries between ticks.
 */
const sightedByZone = new Map<ZoneId, number>();
/** Everything in it, summed. Written by the same pass. */
let sightedTotal = 0;

/** Rebuilds the sighting scratch from the enemy's own contact book. */
function refreshSighting(state: GameState): void {
  sightedByZone.clear();
  sightedTotal = 0;
  for (const contact of state.contacts.enemy.values()) {
    if (!contact.visibleNow) continue;
    const zone = contact.lastSeenZone;
    sightedByZone.set(zone, (sightedByZone.get(zone) ?? 0) + contact.estimatedStrength);
    sightedTotal += contact.estimatedStrength;
  }
}

/**
 * Ground the commander will not march a regiment onto.
 *
 * An army that could be counted on to attack whatever was in front of it was an
 * army the player could farm: gather everything at one bridge, and the scripted
 * assault walked into it a regiment at a time and died. A commander who can see
 * several times his own numbers standing on the objective does not send his men
 * into them — he halts where he is and looks for somewhere else to be.
 *
 * The thresholds are deliberately extreme. This must call off a hopeless
 * assault without calling off the authored battle: an ordinary defence of two
 * or three regiments has to be attacked, or the scenario never happens.
 */
const DECLINE = {
  /** Sighted strength on the objective, relative to the regiment sent at it. */
  ratio: 3.5,
  /** And an absolute floor, so a weak detachment is still expected to attack. */
  minimumMass: 1400,
} as const;

function isHopeless(zone: ZoneId, ownStrength: number): boolean {
  const facing = sightedByZone.get(zone) ?? 0;
  return facing >= DECLINE.minimumMass && facing >= ownStrength * DECLINE.ratio;
}

/**
 * Calling off an assault that has become hopeless.
 *
 * Only a march is ever called off, never a fight already joined: a regiment
 * that has arrived and is in contact has nothing to gain by turning its back.
 * It halts and holds the ground it is standing on rather than streaming home,
 * so refusing an attack does not hand the field away.
 */
function declineHopelessAssaults(state: GameState): GameCommandPayload[] {
  const commands: GameCommandPayload[] = [];
  for (const group of activeGroups(state, 'enemy')) {
    if (isCommitted(state, group)) continue;
    if (group.order.kind !== 'attack_zone' && group.order.kind !== 'move') continue;
    const target = group.order.targetZone;
    if (target === undefined) continue;
    // Still on the road. Once it has arrived, this is a battle, not a plan.
    if (group.path.length === 0 || group.engagement > 0) continue;
    if (!isHopeless(target, group.members.length)) continue;

    commands.push({
      type: 'order_groups',
      playerId: 'enemy',
      groupIds: [group.id],
      order: 'defend_zone',
      targetZone: zoneAt(group.anchor.x, group.anchor.y),
    });
  }
  return commands;
}

/** Idle enemy formations look for the nearest thing they can actually see. */
function reactions(state: GameState): GameCommandPayload[] {
  const difficulty = DIFFICULTIES[state.difficultyId];
  const interval = Math.round(TICKS_PER_SECOND * difficulty.reactionSeconds);
  if (state.currentTick % interval !== 0) return [];

  const commands: GameCommandPayload[] = [];
  const contacts = [...state.contacts.enemy.values()].filter((contact) => contact.visibleNow);
  if (contacts.length === 0) return commands;

  const guardId = state.objective.kings.enemy.guardGroupId;

  for (const group of activeGroups(state, 'enemy')) {
    // The Royal Guard stands over its king whatever else is happening.
    if (group.id === guardId) continue;
    if (isCommitted(state, group)) continue;
    if (!hasFinishedItsOrders(state, group)) continue;

    let nearest = contacts[0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const contact of contacts) {
      const dx = contact.lastPosition.x - group.anchor.x;
      const dy = contact.lastPosition.y - group.anchor.y;
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = contact;
      }
    }

    if (nearest === undefined) continue;
    // And never answer a contact by walking into a mass that has already been
    // judged hopeless, or the commander would undo his own prudence every few
    // seconds.
    if (isHopeless(nearest.lastSeenZone, group.members.length)) continue;
    // Only respond to a genuinely close threat; otherwise hold the line.
    if (nearestDistance > difficulty.reactionRadius * difficulty.reactionRadius) continue;
    // Already standing on the ground it would be sent to: re-issuing would
    // only reset the order clock every few seconds for no movement at all.
    if (zoneAt(group.anchor.x, group.anchor.y) === nearest.lastSeenZone) continue;

    commands.push({
      type: 'order_groups',
      playerId: 'enemy',
      groupIds: [group.id],
      order: 'attack_zone',
      targetZone: nearest.lastSeenZone,
    });
  }

  return commands;
}

/**
 * Relief for the enemy king.
 *
 * Without this, a player who slips a column past the line simply walks up and
 * takes the sovereign unopposed, and the objective stops being a fight. The
 * order is only issued when the group is not already answering the call, so
 * re-evaluating every few seconds does not keep resetting its march.
 */
function defendTheKing(state: GameState): GameCommandPayload[] {
  const difficulty = DIFFICULTIES[state.difficultyId];
  const interval = Math.round(TICKS_PER_SECOND * difficulty.reactionSeconds);
  if (state.currentTick % interval !== 0) return [];

  const king = state.objective.kings.enemy;
  if (!king.besieged && king.captureProgress <= 0) return [];

  const homeZone = homeZoneOf('enemy').id;
  const commands: GameCommandPayload[] = [];
  for (const group of activeGroups(state, 'enemy')) {
    if (isCommitted(state, group)) continue;
    if (group.order.kind === 'defend_zone' && group.order.targetZone === homeZone) continue;

    // Only what is close enough to matter: recalling the whole army would hand
    // the player the entire field for the price of one raid.
    const dx = king.position.x - group.anchor.x;
    const dy = king.position.y - group.anchor.y;
    if (dx * dx + dy * dy > difficulty.kingDefenseRadius * difficulty.kingDefenseRadius) continue;

    commands.push({
      type: 'order_groups',
      playerId: 'enemy',
      groupIds: [group.id],
      order: 'defend_zone',
      targetZone: homeZone,
    });
  }
  return commands;
}

/** Sighted strength below which the commander has read nothing worth acting on. */
const MINIMUM_SIGHTED_STRENGTH = 400;

/**
 * Punishing an army that has committed itself.
 *
 * The strongest move available to a player was to put every regiment he owned
 * onto one crossing and walk through it. The defenders there were outnumbered
 * five to one, and nothing anywhere else on the field ever noticed: the enemy
 * only reacted to what stood close to it, and its own drive on the player's
 * king was on a fixed clock the rush finished well before.
 *
 * So the commander watches where the player's weight actually is. Once it is
 * gathered in one place, everything he has that is clear of the fighting goes
 * the other way, at the sovereign the player has just left unguarded. That
 * turns a rush from a free win into a race, which is the decision the crossing
 * was always supposed to pose.
 *
 * It reads intelligence, never the truth, so it can be fooled: a feint that
 * shows the enemy a mass at one bridge draws his loose regiments away from the
 * other one, exactly as it should.
 */
function exploitTheOpening(state: GameState): GameCommandPayload[] {
  const difficulty = DIFFICULTIES[state.difficultyId];
  const interval = Math.round(TICKS_PER_SECOND * difficulty.reactionSeconds);
  if (state.currentTick % interval !== 0) return [];

  const dueTick = Math.round(
    difficulty.opportunismSeconds * difficulty.timelineScale * TICKS_PER_SECOND,
  );
  const finalPushTick = Math.round(
    difficulty.finalPushSeconds * difficulty.timelineScale * TICKS_PER_SECOND,
  );
  // Before he has any read on the battle, and after he has committed to the
  // last act, this is not the commander's problem.
  if (state.currentTick < dueTick || state.currentTick >= finalPushTick) return [];

  // A commander whose own sovereign is being taken has a nearer problem.
  const ownKing = state.objective.kings.enemy;
  if (ownKing.besieged || ownKing.captureProgress > 0) return [];

  if (sightedTotal < MINIMUM_SIGHTED_STRENGTH) return [];

  // Iterated in the map's authored zone order, never the contact book's own,
  // so which zone wins a tie never depends on what was seen first.
  let heaviestZone: ZoneId | undefined;
  let heaviest = 0;
  for (const id of activeZoneIds()) {
    const weight = sightedByZone.get(id) ?? 0;
    if (weight > heaviest) {
      heaviest = weight;
      heaviestZone = id;
    }
  }
  if (heaviestZone === undefined) return [];
  if (heaviest / sightedTotal < difficulty.opportunismConcentration) return [];

  const mass = ZONES[heaviestZone].center;
  const sighting = state.objective.kings.player.lastSightingByOpponent;
  // His last sighting if there is one; otherwise the base every commander knows
  // is there. Neither is a peek at the truth.
  const targetZone = sighting?.zoneId ?? homeZoneOf('player').id;

  const commands: GameCommandPayload[] = [];
  for (const group of activeGroups(state, 'enemy')) {
    if (isCommitted(state, group)) continue;
    if (!hasFinishedItsOrders(state, group)) continue;
    // Pulling a regiment out of a melee to march round the flank only loses the
    // melee. Only troops already clear of the fighting go.
    if (group.engagement > 0) continue;
    // And only troops far enough from the mass to get away with it.
    const dx = group.anchor.x - mass.x;
    const dy = group.anchor.y - mass.y;
    if (dx * dx + dy * dy < difficulty.reactionRadius * difficulty.reactionRadius) continue;
    if (group.order.kind === 'attack_zone' && group.order.targetZone === targetZone) continue;

    commands.push({
      type: 'order_groups',
      playerId: 'enemy',
      groupIds: [group.id],
      order: 'attack_zone',
      targetZone,
    });
  }

  if (commands.length > 0) {
    raiseAlert(
      state,
      'enemy_exploits_opening',
      'attack',
      'warning',
      `The enemy has seen your army gathered at ${ZONES[heaviestZone].name} and is marching ` +
        'around it.',
      { zoneId: targetZone },
    );
  }
  return commands;
}

/**
 * The final drive on the player's sovereign.
 *
 * Both armies used to fight themselves to a standstill around the crossings
 * and then simply stop: twenty minutes of untouched battle ended with no
 * decision at all, because nothing ever forced the last act. Past the scripted
 * escalation the enemy commander stops trading and goes for the throat, which
 * is what turns a grind into a crisis the player has to answer.
 *
 * It never overrides the defence of his own king — a commander whose sovereign
 * is being taken has a more urgent problem than taking yours.
 */
function finalPush(state: GameState): GameCommandPayload[] {
  const difficulty = DIFFICULTIES[state.difficultyId];
  const dueTick = Math.round(
    difficulty.finalPushSeconds * difficulty.timelineScale * TICKS_PER_SECOND,
  );
  if (state.currentTick < dueTick) return [];

  const interval = Math.round(TICKS_PER_SECOND * difficulty.reactionSeconds);
  if (state.currentTick % interval !== 0) return [];

  const ownKing = state.objective.kings.enemy;
  if (ownKing.besieged || ownKing.captureProgress > 0) return [];

  const target = state.objective.kings.player;
  const targetZone = zoneAt(target.position.x, target.position.y);

  const commands: GameCommandPayload[] = [];
  for (const group of activeGroups(state, 'enemy')) {
    if (isCommitted(state, group)) continue;
    if (!hasFinishedItsOrders(state, group)) continue;
    // Already marching on him: do not reset the march every few seconds.
    if (group.order.kind === 'attack_zone' && group.order.targetZone === targetZone) continue;

    commands.push({
      type: 'order_groups',
      playerId: 'enemy',
      groupIds: [group.id],
      order: 'attack_zone',
      targetZone,
    });
  }

  // Announced once, on the tick the commitment is made. The alert family's
  // cooldown would otherwise re-raise it every twenty seconds until the end.
  if (commands.length > 0 && !state.alertCooldowns.has('enemy_final_push')) {
    raiseAlert(
      state,
      'enemy_final_push',
      'attack',
      'critical',
      'The enemy is committing everything against your King.',
      { zoneId: targetZone },
    );
  }
  return commands;
}

export function enemyAiCommands(state: GameState): GameCommandPayload[] {
  // One read of the contact book per tick, shared by everything below it that
  // needs to know where the player's weight is.
  refreshSighting(state);

  return [
    ...scriptedThisTick(state),
    ...defendTheKing(state),
    ...declineHopelessAssaults(state),
    ...exploitTheOpening(state),
    ...finalPush(state),
    ...reactions(state),
  ];
}
