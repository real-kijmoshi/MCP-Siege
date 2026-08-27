import type { GameState } from '../../simulation/GameState';
import type { CommandFailure, GameCommand } from '../types';

export function failure(
  command: GameCommand, state: GameState, code: string, message: string, suggestions: string[] = [],
): CommandFailure {
  return { ok: false, commandId: command.id, appliedAtTick: state.currentTick, code, message, suggestions };
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function nextEntityId(state: GameState, prefix: string): string {
  const value = state.entitySequence;
  state.entitySequence += 1;
  return `${prefix}_${String(value).padStart(4, '0')}`;
}
