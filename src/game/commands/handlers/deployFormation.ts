import { ZONES, homeZoneOf, isActiveZone, isPassable } from '../../simulation/Zones';
import type { GameState } from '../../simulation/GameState';
import { opponentOf, type TacticalSlot, type Vector2D } from '../../types/domain';
import type { CommandResult, DeployFormationPayload, GameCommand } from '../types';
import { failure, success } from '../types';
import {
  commitPreparedOrder,
  prepareOrderToGroup,
  resolveOwnedGroups,
  type PreparedOrder,
} from './shared';

/** Lateral and forward ranks, scaled to the named zone in the handler. */
const SLOT_OFFSETS = {
  front_left: [-1, 1],
  front_center: [0, 1],
  front_right: [1, 1],
  far_left: [-2, 0],
  left: [-1, 0],
  center: [0, 0],
  right: [1, 0],
  far_right: [2, 0],
  rear_left: [-1, -1],
  rear_center: [0, -1],
  rear_right: [1, -1],
  reserve_left: [-1, -2],
  reserve_center: [0, -2],
  reserve_right: [1, -2],
} as const satisfies Record<TacticalSlot, readonly [number, number]>;

/**
 * Finds dry ground near an intended semantic slot.
 *
 * This search is deterministic and command-time only. It prevents a custom
 * line around a crossing from placing its wing in the river while keeping raw
 * coordinates out of the WebMCP contract.
 */
function passableSlot(intended: Vector2D, occupied: readonly Vector2D[]): Vector2D | undefined {
  const available = (x: number, y: number): boolean => {
    if (!isPassable(x, y)) return false;
    for (const point of occupied) {
      const dx = point.x - x;
      const dy = point.y - y;
      if (dx * dx + dy * dy < 90 * 90) return false;
    }
    return true;
  };

  if (available(intended.x, intended.y)) return intended;

  const directions = 16;
  for (let radius = 40; radius <= 400; radius += 40) {
    for (let direction = 0; direction < directions; direction += 1) {
      const angle = (direction / directions) * Math.PI * 2;
      const x = intended.x + Math.cos(angle) * radius;
      const y = intended.y + Math.sin(angle) * radius;
      if (available(x, y)) return { x, y };
    }
  }
  return undefined;
}

/**
 * Deploys heterogeneous regiments as one atomic command.
 *
 * Each assignment still becomes an ordinary prepared group order. We validate
 * every group, slot, route, formation and stance before committing any of them,
 * preserving the command boundary's all-or-nothing guarantee.
 */
export function handleDeployFormation(
  command: GameCommand & DeployFormationPayload,
  state: GameState,
): CommandResult {
  const tick = state.currentTick;
  if (!isActiveZone(command.targetZone)) {
    return failure(command, tick, 'INVALID_TARGET', 'That location is not on this battlefield.', [
      'Call get_strategic_zones for valid target zones.',
    ]);
  }
  if (command.assignments.length === 0 || command.assignments.length > 14) {
    return failure(command, tick, 'INVALID_INPUT', 'A deployment needs between 1 and 14 assignments.', []);
  }

  const usedSlots = new Set<TacticalSlot>();
  for (const assignment of command.assignments) {
    if (usedSlots.has(assignment.slot)) {
      return failure(command, tick, 'DUPLICATE_SLOT', `Tactical slot "${assignment.slot}" is assigned twice.`, [
        'Give every regiment a distinct slot in the custom deployment.',
      ]);
    }
    usedSlots.add(assignment.slot);
  }

  const resolved = resolveOwnedGroups(
    state,
    command.playerId,
    command.assignments.map((assignment) => assignment.groupId),
  );
  if ('missing' in resolved) {
    return failure(command, tick, 'GROUP_NOT_FOUND', `Group "${resolved.missing}" ${resolved.reason}.`, [
      'Call get_armies for the current order of battle.',
    ]);
  }

  const zone = ZONES[command.targetZone];
  const ownHome = homeZoneOf(command.playerId).center;
  const enemyHome = homeZoneOf(opponentOf(command.playerId)).center;
  const forwardDx = enemyHome.x - ownHome.x;
  const forwardDy = enemyHome.y - ownHome.y;
  const forwardLength = Math.hypot(forwardDx, forwardDy) || 1;
  const forwardX = forwardDx / forwardLength;
  const forwardY = forwardDy / forwardLength;
  const rightX = -forwardY;
  const rightY = forwardX;
  const lateralSpacing = Math.max(200, Math.min(420, zone.radius * 0.55));
  const depthSpacing = Math.max(160, Math.min(320, zone.radius * 0.42));

  const preparedOrders: PreparedOrder[] = [];
  const occupied: Vector2D[] = [];
  for (let index = 0; index < command.assignments.length; index += 1) {
    const assignment = command.assignments[index];
    const group = resolved.groups[index];
    if (assignment === undefined || group === undefined) continue;
    const offset = SLOT_OFFSETS[assignment.slot];
    const intended = {
      x: zone.center.x + rightX * offset[0] * lateralSpacing + forwardX * offset[1] * depthSpacing,
      y: zone.center.y + rightY * offset[0] * lateralSpacing + forwardY * offset[1] * depthSpacing,
    };
    const destination = passableSlot(intended, occupied);
    if (destination === undefined) {
      return failure(
        command,
        tick,
        'FORMATION_DOES_NOT_FIT',
        `${zone.name} has no passable ground for the ${assignment.slot.replaceAll('_', ' ')} slot.`,
        ['Use fewer slots, or choose a broader strategic zone.'],
      );
    }

    const prepared = prepareOrderToGroup(state, group, assignment.order, {
      targetZone: command.targetZone,
      destination,
      ...(assignment.formation !== undefined ? { formation: assignment.formation } : {}),
      ...(assignment.stance !== undefined ? { stance: assignment.stance } : {}),
    });
    if ('ok' in prepared) {
      return failure(
        command,
        tick,
        prepared.code ?? 'ORDER_REJECTED',
        prepared.summary,
        prepared.suggestions ?? ['Check the custom deployment and try again.'],
      );
    }
    occupied.push(destination);
    preparedOrders.push(prepared);
  }

  for (const prepared of preparedOrders) commitPreparedOrder(state, prepared);
  return success(
    command,
    tick,
    `${preparedOrders.length} regiment(s) deploy in a custom formation around ${zone.name}.`,
    { groupIds: preparedOrders.map((prepared) => prepared.group.id) },
  );
}
