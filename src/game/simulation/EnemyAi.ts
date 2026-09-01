import { TICKS_PER_SECOND } from '../config/battle';
import { DIFFICULTIES, type ScriptedAiOrder } from '../config/matches';
import { getScenarioDefinition } from '../config/scenario';
import type { GameCommandPayload, OrderGroupsPayload } from '../commands/types';
import type { ArmyGroup } from '../types/domain';
import { raiseAlert } from './Alerts';
import { activeGroups, findGroup, type GameState } from './GameState';
import { homeZoneOf, zoneAt } from './Zones';

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
  return [
    ...scriptedThisTick(state),
    ...defendTheKing(state),
    ...finalPush(state),
    ...reactions(state),
  ];
}
