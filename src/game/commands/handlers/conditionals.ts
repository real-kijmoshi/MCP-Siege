import { describeCondition } from '../../simulation/Conditions';
import { findGroup, nextEntityId, type GameState } from '../../simulation/GameState';
import { isZoneId } from '../../types/domain';
import type {
  CancelConditionalOrderPayload,
  CommandResult,
  GameCommand,
  SetConditionalOrderPayload,
} from '../types';
import { failure, success } from '../types';

/**
 * Standing conditional orders.
 *
 * These are the same triggers plans use, armed directly. "Retreat Legion II if
 * morale falls below 25" is a single call, and it keeps working while the
 * commander's attention is somewhere else entirely.
 */

export function handleSetConditionalOrder(
  command: GameCommand & SetConditionalOrderPayload,
  state: GameState,
): CommandResult {
  const tick = state.currentTick;
  const group = findGroup(state, command.groupId);

  if (group === undefined || group.ownerId !== command.playerId) {
    return failure(command, tick, 'GROUP_NOT_FOUND', `Group "${command.groupId}" is not yours.`, [
      'Call get_armies for the current order of battle.',
    ]);
  }

  const condition = command.condition;
  if (condition.kind === 'immediate') {
    return failure(
      command,
      tick,
      'INVALID_INPUT',
      'An immediate condition is just an order. Use order_group instead.',
      [],
    );
  }
  if (
    (condition.kind === 'morale_below' || condition.kind === 'strength_below') &&
    findGroup(state, condition.groupId) === undefined
  ) {
    return failure(
      command,
      tick,
      'INVALID_INPUT',
      `Condition names unknown group "${condition.groupId}".`,
      [],
    );
  }
  if (
    (condition.kind === 'enemy_enters_zone' || condition.kind === 'friendly_zone_lost') &&
    !isZoneId(condition.zoneId)
  ) {
    return failure(
      command,
      tick,
      'INVALID_INPUT',
      `Condition names unknown zone "${condition.zoneId}".`,
      ['Call get_strategic_zones for valid names.'],
    );
  }

  if (state.conditionals.length >= 40) {
    return failure(command, tick, 'TOO_MANY_CONDITIONALS', 'Too many standing orders are armed.', [
      'Cancel one with cancel_conditional_order.',
    ]);
  }

  const id = nextEntityId(state, 'cond');
  state.conditionals.push({
    id,
    groupId: command.groupId,
    action: command.action,
    ...(command.targetZone !== undefined ? { targetZone: command.targetZone } : {}),
    ...(command.targetGroupId !== undefined ? { targetGroupId: command.targetGroupId } : {}),
    ...(command.formation !== undefined ? { formation: command.formation } : {}),
    ...(command.stance !== undefined ? { stance: command.stance } : {}),
    condition,
    createdAtTick: tick,
    note: command.note,
  });

  return success(
    command,
    tick,
    `Standing order armed: ${group.name} will ${command.action.replace('_', ' ')} ${describeCondition(condition)}.`,
    { conditionalId: id, groupIds: [group.id] },
  );
}

export function handleCancelConditionalOrder(
  command: GameCommand & CancelConditionalOrderPayload,
  state: GameState,
): CommandResult {
  const tick = state.currentTick;
  const before = state.conditionals.length;

  state.conditionals = state.conditionals.filter((pending) => {
    if (pending.id !== command.conditionalId) return true;
    const group = findGroup(state, pending.groupId);
    // Never let one side disarm the other's standing orders.
    return group !== undefined && group.ownerId !== command.playerId;
  });

  if (state.conditionals.length === before) {
    return failure(
      command,
      tick,
      'CONDITIONAL_NOT_FOUND',
      `No standing order with id "${command.conditionalId}".`,
      ['Call get_active_orders to list armed conditionals.'],
    );
  }

  return success(command, tick, 'Standing order cancelled.', {
    conditionalId: command.conditionalId,
  });
}
