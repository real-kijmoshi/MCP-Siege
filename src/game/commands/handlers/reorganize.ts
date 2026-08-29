import { findGroup, registerGroup, type GameState } from '../../simulation/GameState';
import { zoneAt } from '../../simulation/Zones';
import type { ArmyGroup } from '../../types/domain';
import type {
  CommandResult,
  GameCommand,
  MergeGroupsPayload,
  RenameGroupPayload,
  SplitGroupPayload,
} from '../types';
import { failure, success } from '../types';
import { resolveOwnedGroups } from './shared';

/**
 * Splitting, merging and renaming.
 *
 * Reorganisation is the other half of commanding at scale: detaching a reserve
 * or fusing two spent regiments is often a better answer than moving anything.
 */

/** Readable, stable ids, because the Marshal has to say them back. */
function uniqueGroupId(state: GameState, name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'detachment';
  if (!state.groupIndexById.has(base)) return base;
  let suffix = 2;
  while (state.groupIndexById.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

export function handleSplitGroup(
  command: GameCommand & SplitGroupPayload,
  state: GameState,
): CommandResult {
  const tick = state.currentTick;

  if (!Number.isInteger(command.percent) || command.percent < 1 || command.percent > 99) {
    return failure(command, tick, 'INVALID_INPUT', 'Percent must be an integer between 1 and 99.', [
      'Use 50 to halve a group.',
    ]);
  }

  const resolved = resolveOwnedGroups(state, command.playerId, [command.groupId]);
  if ('missing' in resolved) {
    return failure(command, tick, 'GROUP_NOT_FOUND', `Group "${resolved.missing}" ${resolved.reason}.`, [
      'Call get_armies for the current order of battle.',
    ]);
  }

  const source = resolved.groups[0];
  if (source === undefined) {
    return failure(command, tick, 'GROUP_NOT_FOUND', 'Group is unavailable.', []);
  }
  if (source.members.length < 2) {
    return failure(command, tick, 'GROUP_TOO_SMALL', `${source.name} is too small to split.`, []);
  }

  // Evenly spaced selection, so the detachment inherits the parent's mix of
  // troop types rather than taking whichever category happens to be first.
  const taken: number[] = [];
  const kept: number[] = [];
  for (let position = 0; position < source.members.length; position += 1) {
    const index = source.members[position];
    if (index === undefined) continue;
    const before = Math.floor((position * command.percent) / 100);
    const after = Math.floor(((position + 1) * command.percent) / 100);
    if (after > before) taken.push(index);
    else kept.push(index);
  }

  if (taken.length === 0 || kept.length === 0) {
    return failure(command, tick, 'GROUP_TOO_SMALL', 'That split would leave an empty group.', [
      'Choose a percentage that leaves men on both sides.',
    ]);
  }

  const newId = uniqueGroupId(state, command.newGroupName);
  const slot = state.groups.length;
  const detachment: ArmyGroup = {
    id: newId,
    name: command.newGroupName,
    ownerId: source.ownerId,
    members: taken,
    formation: source.formation,
    stance: source.stance,
    order: { kind: 'hold', issuedAtTick: tick },
    // Offset so the two bodies visibly separate instead of overlapping.
    anchor: { x: source.anchor.x + 140, y: source.anchor.y + 140 },
    facing: source.facing,
    morale: source.morale,
    moraleState: source.moraleState,
    path: [],
    initialStrength: taken.length,
    homeZone: zoneAt(source.anchor.x, source.anchor.y),
    lastCasualtyTick: source.lastCasualtyTick,
    recentCasualties: 0,
    routing: source.routing,
  };

  for (const index of taken) state.units.group[index] = slot;
  source.members = kept;
  source.initialStrength = Math.max(1, Math.round(source.initialStrength * (kept.length / (kept.length + taken.length))));
  registerGroup(state, detachment);

  return success(
    command,
    tick,
    `${source.name} splits: ${detachment.name} takes ${taken.length}, ${source.name} keeps ${kept.length}.`,
    { groupIds: [source.id, newId], newGroupId: newId, affectedUnits: taken.length },
  );
}

export function handleMergeGroups(
  command: GameCommand & MergeGroupsPayload,
  state: GameState,
): CommandResult {
  const tick = state.currentTick;

  if (command.groupIds.length < 2) {
    return failure(command, tick, 'INVALID_INPUT', 'Merging needs at least two groups.', []);
  }

  const resolved = resolveOwnedGroups(state, command.playerId, command.groupIds);
  if ('missing' in resolved) {
    return failure(command, tick, 'GROUP_NOT_FOUND', `Group "${resolved.missing}" ${resolved.reason}.`, [
      'Call get_armies for the current order of battle.',
    ]);
  }

  const [primary, ...rest] = resolved.groups;
  if (primary === undefined) {
    return failure(command, tick, 'GROUP_NOT_FOUND', 'No group to merge into.', []);
  }

  const primarySlot = state.groupIndexById.get(primary.id) ?? -1;
  let absorbed = 0;
  const absorbedNames: string[] = [];

  for (const group of rest) {
    for (const index of group.members) {
      state.units.group[index] = primarySlot;
      primary.members.push(index);
    }
    absorbed += group.members.length;
    absorbedNames.push(group.name);
    primary.initialStrength += group.initialStrength;
    // Merging averages morale weighted by the men each side brings.
    group.members = [];
    group.path = [];
    group.order = { kind: 'idle', issuedAtTick: tick };
  }

  primary.members.sort((a, b) => a - b);
  if (command.newGroupName !== undefined) primary.name = command.newGroupName;

  return success(
    command,
    tick,
    `${absorbedNames.join(', ')} merged into ${primary.name} (${primary.members.length} strong).`,
    { groupIds: [primary.id], affectedUnits: absorbed },
  );
}

export function handleRenameGroup(
  command: GameCommand & RenameGroupPayload,
  state: GameState,
): CommandResult {
  const tick = state.currentTick;
  const group = findGroup(state, command.groupId);

  if (group === undefined || group.ownerId !== command.playerId) {
    return failure(command, tick, 'GROUP_NOT_FOUND', `Group "${command.groupId}" is not yours.`, [
      'Call get_armies for the current order of battle.',
    ]);
  }

  const previous = group.name;
  group.name = command.name;
  return success(command, tick, `${previous} is renamed ${group.name}.`, { groupIds: [group.id] });
}
