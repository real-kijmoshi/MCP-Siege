import type { CommandResult, GameCommand } from '../../game/commands/types';
import {
  QueryError,
  type EconomyOverview,
  type GameOverview,
  type GameQueries,
} from '../../game/queries/GameQueries';
import type { SimulationEngine } from '../../game/simulation/Engine';
import type { WorkerAssignments } from '../../game/types/domain';
import type { MarshalActivityStore } from '../../ui/MarshalActivity';
import { toolFailure, toolSuccess, type ToolResult } from './results';

export interface AssignWorkersInput extends WorkerAssignments {}

export interface WebMcpToolHandlers {
  getGameOverview(): ToolResult<GameOverview>;
  getEconomy(): ToolResult<EconomyOverview>;
  assignWorkers(input: unknown): Promise<ToolResult<CommandResult>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateAssignWorkersInput(input: unknown):
  | { ok: true; value: AssignWorkersInput }
  | { ok: false; message: string } {
  if (!isRecord(input)) return { ok: false, message: 'Input must be an object.' };
  const expected = ['food', 'wood', 'stone', 'iron'];
  const keys = Object.keys(input);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    return { ok: false, message: 'Provide only food, wood, stone, and iron.' };
  }

  for (const resource of expected) {
    const value = input[resource];
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 200) {
      return { ok: false, message: `${resource} must be an integer between 0 and 200.` };
    }
  }

  return {
    ok: true,
    value: {
      food: input.food as number,
      wood: input.wood as number,
      stone: input.stone as number,
      iron: input.iron as number,
    },
  };
}

function waitForResult(engine: SimulationEngine, command: GameCommand): Promise<CommandResult> {
  const existing = engine.getCommandResult(command.id);
  if (existing !== undefined) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const unsubscribe = engine.onCommandResult((completedCommand, result) => {
      if (completedCommand.id !== command.id) return;
      unsubscribe();
      resolve(result);
    });
  });
}

function queryFailure(error: unknown) {
  if (error instanceof QueryError) {
    return toolFailure(error.code, error.message, ['Retry after inspecting the current game.']);
  }
  return toolFailure('QUERY_FAILED', 'The game query could not be completed.', ['Retry the query.']);
}

export function createWebMcpToolHandlers(
  engine: SimulationEngine,
  queries: GameQueries,
  activity: MarshalActivityStore,
  playerId = 'player_kingdom',
): WebMcpToolHandlers {
  return {
    getGameOverview() {
      activity.record('QUERY', 'Marshal inspected the battlefield overview.');
      try {
        return toolSuccess(queries.getGameOverview(playerId));
      } catch (error) {
        const result = queryFailure(error);
        activity.record('ERROR', result.error.message);
        return result;
      }
    },

    getEconomy() {
      activity.record('QUERY', 'Marshal inspected the realm economy.');
      try {
        return toolSuccess(queries.getEconomy(playerId));
      } catch (error) {
        const result = queryFailure(error);
        activity.record('ERROR', result.error.message);
        return result;
      }
    },

    async assignWorkers(input: unknown) {
      const validation = validateAssignWorkersInput(input);
      if (!validation.ok) {
        activity.record('ERROR', `Worker order rejected: ${validation.message}`);
        return toolFailure('INVALID_INPUT', validation.message, [
          'Use get_economy to inspect available workers.',
        ]);
      }

      const { food, wood, stone, iron } = validation.value;
      activity.record(
        'COMMAND',
        `Marshal requested workers: ${food} food · ${wood} wood · ${stone} stone · ${iron} iron.`,
      );
      const command = engine.dispatch('webmcp', {
        type: 'assign_workers',
        playerId,
        assignments: validation.value,
      });
      const result = await waitForResult(engine, command);
      if (!result.ok) {
        activity.record('ERROR', result.message);
        return toolFailure(result.code, result.message, result.suggestions);
      }

      const warnings = 'warnings' in result.data ? result.data.warnings : [];
      activity.record(warnings.length > 0 ? 'WARNING' : 'SUCCESS', result.summary);
      return toolSuccess(result);
    },
  };
}
