import { approachPoint, computePath } from '../../simulation/Navigation';
import { marchClearance } from '../../simulation/Formations';
import { findGroup, type GameState } from '../../simulation/GameState';
import { ZONES, homeZoneOf, isActiveZone, isPassable } from '../../simulation/Zones';
import type {
  ArmyGroup,
  Formation,
  OrderKind,
  PlayerId,
  Stance,
  Vector2D,
  ZoneId,
} from '../../types/domain';

/**
 * The single place a group order is actually applied.
 *
 * A mouse click, a WebMCP command, a fired conditional and the enemy AI all
 * funnel through here, so there is exactly one definition of what "attack the
 * east crossing" means.
 */

export interface OrderOptions {
  targetZone?: ZoneId;
  targetGroupId?: string;
  destination?: Vector2D;
  formation?: Formation;
  stance?: Stance;
  append?: boolean;
}

export interface OrderOutcome {
  ok: boolean;
  summary: string;
  code?: string;
  suggestions?: string[];
}

/** Groups owned by `playerId`, reporting the first id that does not qualify. */
export function resolveOwnedGroups(
  state: GameState,
  playerId: PlayerId,
  groupIds: readonly string[],
): { groups: ArmyGroup[] } | { missing: string; reason: string } {
  const groups: ArmyGroup[] = [];
  const seen = new Set<string>();
  for (const id of groupIds) {
    if (seen.has(id)) return { missing: id, reason: 'was named more than once' };
    seen.add(id);
    const group = findGroup(state, id);
    if (group === undefined) return { missing: id, reason: 'no such group' };
    if (group.ownerId !== playerId) return { missing: id, reason: 'not under your command' };
    if (group.members.length === 0) return { missing: id, reason: 'has been destroyed' };
    groups.push(group);
  }
  return { groups };
}

/**
 * Where an order sends a group.
 *
 * Attacking a named enemy group deliberately routes to its *last known*
 * position taken from the ordering side's own contacts, never its true
 * position, so issuing an attack cannot be used to locate a hidden army.
 */
function resolveDestination(
  state: GameState,
  group: ArmyGroup,
  order: OrderKind,
  options: OrderOptions,
): { position: Vector2D } | { error: string; suggestions: string[] } {
  if (options.destination !== undefined) {
    if (!isPassable(options.destination.x, options.destination.y)) {
      return {
        error: 'That destination is impassable ground.',
        suggestions: ['Choose dry ground inside the battlefield.'],
      };
    }
    return { position: { x: options.destination.x, y: options.destination.y } };
  }

  if (order === 'retreat') {
    const home = homeZoneOf(group.ownerId);
    return { position: approachPoint(home.id, group.anchor) };
  }

  if (order === 'attack_group' || order === 'support') {
    const targetId = options.targetGroupId;
    if (targetId === undefined) {
      return { error: 'This order requires a target group.', suggestions: ['Provide targetGroupId.'] };
    }
    const target = findGroup(state, targetId);
    if (order === 'support') {
      if (target === undefined || target.members.length === 0 || target.ownerId !== group.ownerId) {
        return {
          error: `Friendly group "${targetId}" is unavailable.`,
          suggestions: ['Call get_armies for groups under your command.'],
        };
      }
      return { position: { x: target.anchor.x, y: target.anchor.y } };
    }

    const contact = state.contacts[group.ownerId].get(targetId);
    if (
      contact === undefined ||
      target === undefined ||
      target.members.length === 0 ||
      target.ownerId === group.ownerId
    ) {
      return {
        error: `No actionable intelligence is available for target "${targetId}".`,
        suggestions: ['Call get_intelligence.', 'Scout the area first.'],
      };
    }
    return { position: { x: contact.lastPosition.x, y: contact.lastPosition.y } };
  }

  const zoneId = options.targetZone;
  if (zoneId === undefined) {
    return {
      error: 'This order requires a target zone.',
      suggestions: ['Provide targetZone.', 'Call get_strategic_zones for valid names.'],
    };
  }
  if (!isActiveZone(zoneId)) {
    return {
      error: 'That location is not on this battlefield.',
      suggestions: ['Call get_strategic_zones for valid names.'],
    };
  }

  // An assault drives onto the objective itself. A move or a defensive
  // deployment stops on the near edge, so arriving armies muster rather than
  // piling onto the same point.
  if (order === 'attack_zone') {
    const zone = ZONES[zoneId];
    return { position: { x: zone.center.x, y: zone.center.y } };
  }
  return { position: approachPoint(zoneId, group.anchor) };
}

export interface PreparedOrder {
  group: ArmyGroup;
  order: OrderKind;
  options: OrderOptions;
  position?: Vector2D;
  path?: Vector2D[];
}

/** Validates and resolves an order without mutating authoritative state. */
export function prepareOrderToGroup(
  state: GameState,
  group: ArmyGroup,
  order: OrderKind,
  options: OrderOptions = {},
): PreparedOrder | OrderOutcome {
  if (group.routing) {
    return {
      ok: false,
      code: 'GROUP_ROUTING',
      summary: `${group.name} is routing and will not accept orders until it rallies.`,
      suggestions: ['Wait for the group to rally, or support it with a nearby formation.'],
    };
  }

  if (order === 'hold' || order === 'idle') {
    return { group, order, options };
  }

  const resolved = resolveDestination(state, group, order, options);
  if ('error' in resolved) {
    return {
      ok: false,
      code: 'INVALID_TARGET',
      summary: resolved.error,
      suggestions: resolved.suggestions,
    };
  }

  const formation = options.formation ?? group.formation;
  const clearance = marchClearance(formation, group.members.length);
  const pathStart = options.append ? group.path[group.path.length - 1] ?? group.anchor : group.anchor;
  const path = computePath(pathStart, resolved.position, clearance);
  return { group, order, options, position: resolved.position, path };
}

/** Commits a previously validated order. Call only after the whole command is valid. */
export function commitPreparedOrder(state: GameState, prepared: PreparedOrder): OrderOutcome {
  const { group, order, options } = prepared;
  if (options.formation !== undefined) group.formation = options.formation;
  if (options.stance !== undefined) group.stance = options.stance;

  if (order === 'hold' || order === 'idle') {
    group.path = [];
    group.order = { kind: order, issuedAtTick: state.currentTick };
    return { ok: true, summary: `${group.name} holds position.` };
  }

  const path = prepared.path ?? [];
  if (options.append) group.path.push(...path);
  else group.path = path;
  const nextOrder: ArmyGroup['order'] = { kind: order, issuedAtTick: state.currentTick };
  if (options.targetZone !== undefined) nextOrder.targetZone = options.targetZone;
  if (options.targetGroupId !== undefined) nextOrder.targetGroupId = options.targetGroupId;
  if (prepared.position !== undefined) nextOrder.destination = prepared.position;
  group.order = nextOrder;

  const queued = options.append ? ' Queued after its current march.' : '';
  return { ok: true, summary: `${group.name} ${describeOrder(order, options)}.${queued}` };
}

export function applyOrderToGroup(
  state: GameState,
  group: ArmyGroup,
  order: OrderKind,
  options: OrderOptions = {},
): OrderOutcome {
  const prepared = prepareOrderToGroup(state, group, order, options);
  if ('ok' in prepared) return prepared;
  return commitPreparedOrder(state, prepared);
}

export function describeOrder(order: OrderKind, options: OrderOptions): string {
  const zone = options.targetZone === undefined ? undefined : ZONES[options.targetZone].name;
  switch (order) {
    case 'move':
      return zone === undefined ? 'advances' : `advances to ${zone}`;
    case 'attack_zone':
      return zone === undefined ? 'attacks' : `attacks ${zone}`;
    case 'attack_group':
      return `attacks ${options.targetGroupId ?? 'the enemy'}`;
    case 'defend_zone':
      return zone === undefined ? 'takes up defence' : `defends ${zone}`;
    case 'scout':
      return zone === undefined ? 'scouts ahead' : `scouts ${zone}`;
    case 'support':
      return `moves to support ${options.targetGroupId ?? 'the line'}`;
    case 'retreat':
      return 'withdraws to the rear';
    case 'hold':
      return 'holds position';
    case 'idle':
      return 'stands down';
  }
}
