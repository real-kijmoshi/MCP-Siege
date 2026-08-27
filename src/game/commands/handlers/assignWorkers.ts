import type { GameState } from '../../simulation/GameState';
import { RESOURCE_TYPES, emptyWorkerAssignments } from '../../types/domain';
import type { CommandResult, GameCommand } from '../types';
import { failure } from './shared';

export function handleAssignWorkers(command: GameCommand, state: GameState): CommandResult {
  if (command.type !== 'assign_workers') return failure(command, state, 'UNSUPPORTED_COMMAND', 'Unsupported command.');
  if (state.players[command.playerId] === undefined) return failure(command, state, 'PLAYER_NOT_FOUND', 'Player is unavailable.');
  for (const resource of RESOURCE_TYPES) {
    if (!Number.isInteger(command.assignments[resource]) || command.assignments[resource] < 0 || command.assignments[resource] > 200) {
      return failure(command, state, 'INVALID_WORKER_COUNT', `${resource} must be an integer between 0 and 200.`);
    }
  }
  const workers = Object.values(state.villagers)
    .filter((worker) => worker.ownerId === command.playerId)
    .sort((a, b) => a.id.localeCompare(b.id));
  const applied = emptyWorkerAssignments();
  const requestedTotal = RESOURCE_TYPES.reduce((sum, resource) => sum + command.assignments[resource], 0);
  let cursor = 0;
  for (const resource of RESOURCE_TYPES) {
    const origin = workers[0]?.position ?? { x: 0, y: 0 };
    const node = Object.values(state.resourceNodes)
      .filter((candidate) => candidate.type === resource && candidate.remaining > 0)
      .sort((a, b) =>
        Math.hypot(a.position.x - origin.x, a.position.y - origin.y) -
          Math.hypot(b.position.x - origin.x, b.position.y - origin.y) ||
        a.id.localeCompare(b.id))[0];
    if (node === undefined) continue;
    for (let count = 0; count < command.assignments[resource] && cursor < workers.length; count += 1) {
      const worker = workers[cursor++];
      if (worker === undefined) continue;
      worker.job = 'moving';
      worker.order = { kind: 'gather', targetId: node.id, targetPosition: { ...node.position } };
      applied[resource] += 1;
    }
  }
  while (cursor < workers.length) {
    const worker = workers[cursor++];
    if (worker === undefined) continue;
    worker.job = 'idle';
    delete worker.order;
  }
  const warnings = requestedTotal > workers.length ? [`Requested ${requestedTotal} workers but only ${workers.length} are available.`] : [];
  return {
    ok: true, commandId: command.id, appliedAtTick: state.currentTick,
    summary: 'Worker gathering orders updated; villagers will walk to their resource sites.',
    affectedEntities: workers.map((worker) => worker.id),
    data: { assignments: applied, idleWorkers: workers.length - Object.values(applied).reduce((a, b) => a + b, 0), warnings },
  };
}
