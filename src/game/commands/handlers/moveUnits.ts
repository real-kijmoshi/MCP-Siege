import { WORLD_HEIGHT, WORLD_WIDTH } from '../../config/gameplay';
import type { GameState } from '../../simulation/GameState';
import type { CommandResult, GameCommand } from '../types';
import { failure } from './shared';

export function handleMoveUnits(command: GameCommand, state: GameState): CommandResult {
  if (command.type !== 'move_units') return failure(command, state, 'UNSUPPORTED_COMMAND', 'Unsupported command.');
  if (state.players[command.playerId] === undefined) return failure(command, state, 'PLAYER_NOT_FOUND', 'Player is unavailable.');
  if (!Number.isFinite(command.destination.x) || !Number.isFinite(command.destination.y) ||
      command.destination.x < 0 || command.destination.x > WORLD_WIDTH ||
      command.destination.y < 0 || command.destination.y > WORLD_HEIGHT) {
    return failure(command, state, 'INVALID_DESTINATION', 'The destination is outside the battlefield.');
  }
  const ids = [...new Set(command.unitIds)].sort();
  if (ids.length < 1 || ids.length > 200) return failure(command, state, 'INVALID_SELECTION', 'Select between 1 and 200 units.');
  const units = ids.map((id) => state.units[id]);
  if (units.some((unit) => unit === undefined || unit.ownerId !== command.playerId)) {
    return failure(command, state, 'UNIT_NOT_OWNED', 'Every ordered unit must be friendly.');
  }
  const columns = Math.ceil(Math.sqrt(ids.length));
  for (let index = 0; index < ids.length; index += 1) {
    const unit = state.units[ids[index] ?? ''];
    if (unit === undefined) continue;
    const offset = { x: (index % columns - (columns - 1) / 2) * 24, y: Math.floor(index / columns) * 24 };
    unit.order = {
      kind: 'move',
      targetPosition: { x: command.destination.x + offset.x, y: command.destination.y + offset.y },
    };
    const villager = state.villagers[unit.id];
    if (villager !== undefined) villager.job = 'moving';
  }
  return {
    ok: true, commandId: command.id, appliedAtTick: state.currentTick,
    summary: `${ids.length} unit${ids.length === 1 ? '' : 's'} moving across the battlefield.`,
    affectedEntities: ids,
    data: { destination: { ...command.destination }, movedUnits: ids, warnings: [] },
  };
}
