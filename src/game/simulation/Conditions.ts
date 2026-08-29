import { TICKS_PER_SECOND } from '../config/battle';
import type {
  GameCommandPayload,
  OrderGroupsPayload,
  ChangeFormationPayload,
} from '../commands/types';
import type {
  PendingConditionalOrder,
  PlanCondition,
  PlayerId,
} from '../types/domain';
import { findGroup, type GameState } from './GameState';

/**
 * Conditional orders.
 *
 * Triggers come from a closed vocabulary rather than arbitrary code, which is
 * what makes it safe to let an external agent arm them. Every condition is
 * evaluated against the issuing side's own intelligence, so a trigger can never
 * react to something that side cannot see.
 */

export function evaluateCondition(
  state: GameState,
  playerId: PlayerId,
  condition: PlanCondition,
  armedAtTick: number,
): boolean {
  switch (condition.kind) {
    case 'immediate':
      return true;

    case 'after_step':
      return state.completedSteps.has(condition.stepId);

    case 'morale_below': {
      const group = findGroup(state, condition.groupId);
      return group !== undefined && group.members.length > 0 && group.morale < condition.value;
    }

    case 'strength_below': {
      const group = findGroup(state, condition.groupId);
      if (group === undefined) return false;
      const percent = (group.members.length / Math.max(1, group.initialStrength)) * 100;
      return percent < condition.percent;
    }

    case 'enemy_enters_zone': {
      for (const contact of state.contacts[playerId].values()) {
        if (contact.visibleNow && contact.lastSeenZone === condition.zoneId) return true;
      }
      return false;
    }

    case 'friendly_zone_lost':
      return state.zoneControl.get(condition.zoneId) !== playerId;

    case 'enemy_unit_type_visible': {
      for (const contact of state.contacts[playerId].values()) {
        if (!contact.visibleNow) continue;
        if (!contact.composition.includes(condition.category)) continue;
        if (condition.zoneId !== undefined && contact.lastSeenZone !== condition.zoneId) continue;
        return true;
      }
      return false;
    }

    case 'timer_elapsed':
      return state.currentTick - armedAtTick >= condition.seconds * TICKS_PER_SECOND;
  }
}

/** Human-readable description used in tool results and the plan overlay. */
export function describeCondition(condition: PlanCondition): string {
  switch (condition.kind) {
    case 'immediate':
      return 'immediately';
    case 'after_step':
      return `after step ${condition.stepId}`;
    case 'morale_below':
      return `when ${condition.groupId} morale falls below ${condition.value}%`;
    case 'strength_below':
      return `when ${condition.groupId} falls below ${condition.percent}% strength`;
    case 'enemy_enters_zone':
      return `when enemies enter ${condition.zoneId}`;
    case 'friendly_zone_lost':
      return `if ${condition.zoneId} is lost`;
    case 'enemy_unit_type_visible':
      return condition.zoneId === undefined
        ? `when enemy ${condition.category} become visible`
        : `when enemy ${condition.category} become visible at ${condition.zoneId}`;
    case 'timer_elapsed':
      return `after ${condition.seconds}s`;
  }
}

/** Turns a fired conditional into the ordinary command it stands for. */
function payloadFor(
  playerId: PlayerId,
  pending: PendingConditionalOrder,
): GameCommandPayload | undefined {
  if (pending.action === 'change_formation') {
    const payload: ChangeFormationPayload = {
      type: 'change_formation',
      playerId,
      groupIds: [pending.groupId],
    };
    if (pending.formation !== undefined) payload.formation = pending.formation;
    if (pending.stance !== undefined) payload.stance = pending.stance;
    return payload;
  }

  const payload: OrderGroupsPayload = {
    type: 'order_groups',
    playerId,
    groupIds: [pending.groupId],
    order: pending.action,
  };
  if (pending.targetZone !== undefined) payload.targetZone = pending.targetZone;
  if (pending.targetGroupId !== undefined) payload.targetGroupId = pending.targetGroupId;
  if (pending.formation !== undefined) payload.formation = pending.formation;
  if (pending.stance !== undefined) payload.stance = pending.stance;
  return payload;
}

/**
 * Evaluates every armed conditional and returns the commands that fired.
 *
 * Fired orders are dispatched by the engine as ordinary commands rather than
 * applied here, so a conditional and a mouse click reach the simulation through
 * exactly the same path.
 */
export function collectTriggeredOrders(state: GameState): GameCommandPayload[] {
  if (state.conditionals.length === 0) return [];

  const fired: GameCommandPayload[] = [];
  const remaining: PendingConditionalOrder[] = [];

  for (const pending of state.conditionals) {
    const owner = findGroup(state, pending.groupId)?.ownerId;
    if (owner === undefined) continue; // The group no longer exists; drop it.

    if (!evaluateCondition(state, owner, pending.condition, pending.createdAtTick)) {
      remaining.push(pending);
      continue;
    }

    const payload = payloadFor(owner, pending);
    if (payload !== undefined) fired.push(payload);
    if (pending.stepId !== undefined) state.completedSteps.add(pending.stepId);
  }

  state.conditionals = remaining;
  return fired;
}
