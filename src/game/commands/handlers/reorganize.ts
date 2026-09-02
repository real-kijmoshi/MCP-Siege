import { findGroup, registerGroup, type GameState } from '../../simulation/GameState';
import { isPassable, zoneAt } from '../../simulation/Zones';
import type { ArmyGroup } from '../../types/domain';
import type {
  CommandResult,
  DetachCategoryPayload,
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

/** Keeps a newly detached regiment on legal ground near its parent. */
function detachmentAnchor(source: ArmyGroup): { x: number; y: number } {
  const offsets = [
    [140, 140],
    [-140, 140],
    [140, -140],
    [-140, -140],
    [200, 0],
    [-200, 0],
    [0, 200],
    [0, -200],
  ] as const;
  for (const [dx, dy] of offsets) {
    const x = source.anchor.x + dx;
    const y = source.anchor.y + dy;
    if (isPassable(x, y)) return { x, y };
  }
  return { x: source.anchor.x, y: source.anchor.y };
}

function registerDetachment(
  state: GameState,
  source: ArmyGroup,
  members: number[],
  name: string,
): ArmyGroup {
  const tick = state.currentTick;
  const newId = uniqueGroupId(state, name);
  const slot = state.groups.length;
  const anchor = detachmentAnchor(source);
  const detachment: ArmyGroup = {
    id: newId,
    name,
    ownerId: source.ownerId,
    members,
    formation: source.formation,
    stance: source.stance,
    order: { kind: 'hold', issuedAtTick: tick },
    anchor,
    facing: source.facing,
    morale: source.morale,
    moraleState: source.moraleState,
    path: [],
    stallTicks: 0,
    lastReplanTick: -1,
    initialStrength: members.length,
    homeZone: zoneAt(anchor.x, anchor.y),
    lastCasualtyTick: source.lastCasualtyTick,
    recentCasualties: 0,
    routing: source.routing,
    engagement: 0,
    encirclement: 0,
    crowding: 0,
    fatigue: source.fatigue,
    succour: 0,
  };
  for (const index of members) state.units.group[index] = slot;
  registerGroup(state, detachment);
  return detachment;
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

  const detachment = registerDetachment(state, source, taken, command.newGroupName);
  source.members = kept;
  source.initialStrength = Math.max(1, Math.round(source.initialStrength * (kept.length / (kept.length + taken.length))));

  return success(
    command,
    tick,
    `${source.name} splits: ${detachment.name} takes ${taken.length}, ${source.name} keeps ${kept.length}.`,
    { groupIds: [source.id, detachment.id], newGroupId: detachment.id, affectedUnits: taken.length },
  );
}

/** Detaches only one troop category; individual soldiers remain private pool indices. */
export function handleDetachCategory(
  command: GameCommand & DetachCategoryPayload,
  state: GameState,
): CommandResult {
  const tick = state.currentTick;
  if (!Number.isInteger(command.percent) || command.percent < 1 || command.percent > 100) {
    return failure(command, tick, 'INVALID_INPUT', 'Percent must be an integer between 1 and 100.', []);
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

  let categoryCount = 0;
  for (const index of source.members) {
    if (state.units.categoryOf(index) === command.category) categoryCount += 1;
  }
  if (categoryCount === 0) {
    return failure(command, tick, 'CATEGORY_NOT_PRESENT', `${source.name} has no ${command.category}.`, [
      'Call get_army_details to inspect the regiment composition.',
    ]);
  }

  const takeCount = Math.max(1, Math.round((categoryCount * command.percent) / 100));
  if (takeCount >= source.members.length) {
    return failure(command, tick, 'GROUP_TOO_SMALL', 'That detachment would empty the source regiment.', [
      'Detach a smaller share, or rename the existing regiment instead.',
    ]);
  }

  const taken: number[] = [];
  const kept: number[] = [];
  let categoryPosition = 0;
  for (const index of source.members) {
    if (state.units.categoryOf(index) !== command.category) {
      kept.push(index);
      continue;
    }
    const before = Math.floor((categoryPosition * takeCount) / categoryCount);
    const after = Math.floor(((categoryPosition + 1) * takeCount) / categoryCount);
    if (after > before) taken.push(index);
    else kept.push(index);
    categoryPosition += 1;
  }

  const detachment = registerDetachment(state, source, taken, command.newGroupName);
  source.members = kept;
  source.initialStrength = Math.max(
    1,
    Math.round(source.initialStrength * (kept.length / (kept.length + taken.length))),
  );
  return success(
    command,
    tick,
    `${detachment.name} detaches ${taken.length} ${command.category} from ${source.name}.`,
    {
      groupIds: [source.id, detachment.id],
      newGroupId: detachment.id,
      affectedUnits: taken.length,
    },
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
