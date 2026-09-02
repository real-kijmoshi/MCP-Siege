import { FORMATION_PROFILES } from '../../config/battle';
import { findGroup, type GameState } from '../../simulation/GameState';
import { deployWave } from '../../simulation/Reinforcements';
import { ZONES, isActiveZone } from '../../simulation/Zones';
import type {
  ChangeFormationPayload,
  CommandResult,
  DirectReinforcementsPayload,
  FocusSiegePayload,
  GameCommand,
  OrderGroupsPayload,
} from '../types';
import { failure, success } from '../types';
import {
  applyOrderToGroup,
  commitPreparedOrder,
  prepareOrderToGroup,
  resolveOwnedGroups,
  type PreparedOrder,
} from './shared';

export function handleOrderGroups(
  command: GameCommand & OrderGroupsPayload,
  state: GameState,
): CommandResult {
  const tick = state.currentTick;
  if (command.groupIds.length === 0) {
    return failure(command, tick, 'INVALID_INPUT', 'Select at least one group.', [
      'Call get_armies for the current order of battle.',
    ]);
  }
  const resolved = resolveOwnedGroups(state, command.playerId, command.groupIds);
  if ('missing' in resolved) {
    return failure(
      command,
      tick,
      'GROUP_NOT_FOUND',
      `Group "${resolved.missing}" ${resolved.reason}.`,
      ['Call get_armies for the current order of battle.'],
    );
  }

  const preparedOrders: PreparedOrder[] = [];

  for (const group of resolved.groups) {
    const options = {
      ...(command.targetZone !== undefined ? { targetZone: command.targetZone } : {}),
      ...(command.targetGroupId !== undefined ? { targetGroupId: command.targetGroupId } : {}),
      ...(command.destination !== undefined ? { destination: command.destination } : {}),
      ...(command.formation !== undefined ? { formation: command.formation } : {}),
      ...(command.stance !== undefined ? { stance: command.stance } : {}),
      ...(command.append !== undefined ? { append: command.append } : {}),
    };
    const prepared = prepareOrderToGroup(state, group, command.order, options);
    if ('ok' in prepared) {
      return failure(
        command,
        tick,
        prepared.code ?? 'ORDER_REJECTED',
        prepared.summary,
        prepared.suggestions ?? ['Check the selected groups and target.'],
      );
    }
    preparedOrders.push(prepared);
  }

  const summaries: string[] = [];
  const affected: string[] = [];
  for (const prepared of preparedOrders) {
    const outcome = commitPreparedOrder(state, prepared);
    summaries.push(outcome.summary);
    affected.push(prepared.group.id);
  }

  return success(command, tick, summaries.join(' '), { groupIds: affected });
}

export function handleChangeFormation(
  command: GameCommand & ChangeFormationPayload,
  state: GameState,
): CommandResult {
  const tick = state.currentTick;
  if (command.formation === undefined && command.stance === undefined) {
    return failure(command, tick, 'INVALID_INPUT', 'Provide a formation, a stance, or both.', [
      'Valid formations: line, column, block, wedge, double_line, loose, square.',
    ]);
  }

  const resolved = resolveOwnedGroups(state, command.playerId, command.groupIds);
  if ('missing' in resolved) {
    return failure(
      command,
      tick,
      'GROUP_NOT_FOUND',
      `Group "${resolved.missing}" ${resolved.reason}.`,
      ['Call get_armies for the current order of battle.'],
    );
  }

  const affected: string[] = [];
  for (const group of resolved.groups) {
    if (command.formation !== undefined) group.formation = command.formation;
    if (command.stance !== undefined) group.stance = command.stance;
    affected.push(group.id);
  }

  const parts: string[] = [];
  if (command.formation !== undefined) {
    parts.push(`${FORMATION_PROFILES[command.formation].label} formation`);
  }
  if (command.stance !== undefined) parts.push(`${command.stance.replace('_', ' ')} stance`);

  return success(
    command,
    tick,
    `${affected.length} group(s) adopt ${parts.join(' and ')}.`,
    { groupIds: affected },
  );
}

/**
 * Siege and artillery are slow and fragile, so committing them is its own
 * decision. Both arms answer to this: what they have in common is that they are
 * ordered at ground rather than at troops, and that getting them there is most
 * of the work of using them.
 */
export function handleFocusSiege(
  command: GameCommand & FocusSiegePayload,
  state: GameState,
): CommandResult {
  const tick = state.currentTick;
  const resolved = resolveOwnedGroups(state, command.playerId, [command.siegeGroupId]);
  if ('missing' in resolved) {
    return failure(
      command,
      tick,
      'GROUP_NOT_FOUND',
      `Group "${resolved.missing}" ${resolved.reason}.`,
      ['Call get_armies for the current order of battle.'],
    );
  }

  const group = resolved.groups[0];
  if (group === undefined) {
    return failure(command, tick, 'GROUP_NOT_FOUND', 'Siege group is unavailable.', []);
  }

  const hasEngines = group.members.some((index) => {
    const category = state.units.categoryOf(index);
    return category === 'siege' || category === 'cannon';
  });
  if (!hasEngines) {
    return failure(
      command,
      tick,
      'NOT_A_SIEGE_GROUP',
      `${group.name} contains no siege engines or guns.`,
      ['Call get_army_details to inspect composition.'],
    );
  }

  const outcome = applyOrderToGroup(state, group, 'attack_zone', {
    targetZone: command.targetZone,
    // Dispersed and stationary: engines want range, not contact. It matters
    // more for guns than for anything else on the field, because a piece that
    // is still moving has not been unlimbered and cannot fire at all.
    formation: 'loose',
    stance: 'hold_ground',
  });
  if (!outcome.ok) {
    return failure(command, tick, outcome.code ?? 'ORDER_REJECTED', outcome.summary, outcome.suggestions ?? []);
  }

  return success(
    command,
    tick,
    `${group.name} bombards ${ZONES[command.targetZone].name}.`,
    { groupIds: [group.id] },
  );
}

export function handleDirectReinforcements(
  command: GameCommand & DirectReinforcementsPayload,
  state: GameState,
): CommandResult {
  const tick = state.currentTick;
  if (command.targetGroupId !== undefined && command.targetZone !== undefined) {
    return failure(command, tick, 'INVALID_INPUT', 'Choose a target group or a target zone, not both.', []);
  }
  if (command.targetGroupId !== undefined) {
    const target = findGroup(state, command.targetGroupId);
    if (target === undefined || target.ownerId !== command.playerId || target.members.length === 0) {
      return failure(command, tick, 'INVALID_TARGET', 'The reinforcement target is unavailable.', [
        'Call get_armies for groups under your command.',
      ]);
    }
  }
  if (command.targetZone !== undefined && !isActiveZone(command.targetZone)) {
    return failure(command, tick, 'INVALID_TARGET', 'That location is not on this battlefield.', [
      'Call get_strategic_zones for valid names.',
    ]);
  }
  const player = state.players[command.playerId];

  if (player.availableWaves <= 0) {
    const remaining = Math.max(0, 900 - player.manpower);
    return failure(
      command,
      tick,
      'NO_REINFORCEMENTS',
      'No reinforcement wave is ready yet.',
      [`Roughly ${Math.ceil(remaining / 0.9 / 20)}s of manpower remain before the next wave.`],
    );
  }

  const waveNumber = player.wavesDeployed + 1;
  const group = deployWave(state, command.playerId, `Reinforcements ${waveNumber}`);
  if (group === undefined) {
    return failure(command, tick, 'DEPLOY_FAILED', 'The reinforcement wave could not muster.', []);
  }

  if (command.targetGroupId !== undefined) {
    const outcome = applyOrderToGroup(state, group, 'support', {
      targetGroupId: command.targetGroupId,
    });
    if (outcome.ok) {
      return success(
        command,
        tick,
        `${group.name} (${group.members.length}) musters and marches to support ${command.targetGroupId}.`,
        { groupIds: [group.id], newGroupId: group.id },
      );
    }
  }

  if (command.targetZone !== undefined) {
    applyOrderToGroup(state, group, 'move', { targetZone: command.targetZone });
    return success(
      command,
      tick,
      `${group.name} (${group.members.length}) musters and marches to ${ZONES[command.targetZone].name}.`,
      { groupIds: [group.id], newGroupId: group.id },
    );
  }

  return success(
    command,
    tick,
    `${group.name} (${group.members.length}) musters at the base and awaits orders.`,
    { groupIds: [group.id], newGroupId: group.id },
  );
}
