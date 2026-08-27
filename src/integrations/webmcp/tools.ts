import type { CommandResult, GameCommand } from '../../game/commands/types';
import {
  QueryError,
  type EconomyOverview,
  type GameOverview,
  type CommandEntityOverview,
  type GameQueries,
} from '../../game/queries/GameQueries';
import type { SimulationEngine } from '../../game/simulation/Engine';
import {
  BUILDING_TYPES, COMBAT_STANCES, FORMATION_TYPES, UNIT_TYPES,
  type BuildingType, type CombatStance, type FormationType, type UnitType, type WorkerAssignments,
} from '../../game/types/domain';
import type { MarshalActivityStore } from '../../ui/MarshalActivity';
import { toolFailure, toolSuccess, type ToolResult } from './results';

export interface AssignWorkersInput extends WorkerAssignments {}

export interface WebMcpToolHandlers {
  getGameOverview(): ToolResult<GameOverview>;
  getEconomy(): ToolResult<EconomyOverview>;
  getCommandEntities(): ToolResult<CommandEntityOverview>;
  assignWorkers(input: unknown): Promise<ToolResult<CommandResult>>;
  constructBuilding(input: unknown): Promise<ToolResult<CommandResult>>;
  trainUnit(input: unknown): Promise<ToolResult<CommandResult>>;
  orderUnits(input: unknown): Promise<ToolResult<CommandResult>>;
}

interface ConstructBuildingInput { buildingType: BuildingType; workerIds: string[]; x: number; y: number }
interface TrainUnitInput { buildingId: string; unitType: UnitType }
interface OrderUnitsInput { unitIds: string[]; order: 'move' | 'attack' | 'attack_move' | 'stop' | 'hold_position' | 'defend_area' | 'retreat'; targetId?: string; x?: number; y?: number; formation?: FormationType; stance?: CombatStance }

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

function validIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 200 && value.every((id) => typeof id === 'string' && id.length > 0) && new Set(value).size === value.length;
}

function exactKeys(input: Record<string, unknown>, allowed: string[], required: string[]): boolean {
  return Object.keys(input).every((key) => allowed.includes(key)) && required.every((key) => key in input);
}

export function validateConstructBuildingInput(input: unknown): { ok: true; value: ConstructBuildingInput } | { ok: false; message: string } {
  if (!isRecord(input) || !exactKeys(input, ['buildingType', 'workerIds', 'x', 'y'], ['buildingType', 'workerIds', 'x', 'y'])) return { ok: false, message: 'Provide only buildingType, workerIds, x, and y.' };
  if (typeof input.buildingType !== 'string' || input.buildingType === 'town_hall' || !BUILDING_TYPES.includes(input.buildingType as BuildingType)) return { ok: false, message: 'Choose a constructible buildingType.' };
  if (!validIdList(input.workerIds)) return { ok: false, message: 'workerIds must contain 1 to 200 unique unit IDs.' };
  if (typeof input.x !== 'number' || typeof input.y !== 'number' || !Number.isFinite(input.x) || !Number.isFinite(input.y)) return { ok: false, message: 'x and y must be finite coordinates.' };
  return { ok: true, value: { buildingType: input.buildingType as BuildingType, workerIds: input.workerIds, x: input.x, y: input.y } };
}

export function validateTrainUnitInput(input: unknown): { ok: true; value: TrainUnitInput } | { ok: false; message: string } {
  if (!isRecord(input) || !exactKeys(input, ['buildingId', 'unitType'], ['buildingId', 'unitType'])) return { ok: false, message: 'Provide only buildingId and unitType.' };
  if (typeof input.buildingId !== 'string' || input.buildingId.length === 0 || typeof input.unitType !== 'string' || !UNIT_TYPES.includes(input.unitType as UnitType)) return { ok: false, message: 'Provide a valid buildingId and unitType.' };
  return { ok: true, value: { buildingId: input.buildingId, unitType: input.unitType as UnitType } };
}

export function validateOrderUnitsInput(input: unknown): { ok: true; value: OrderUnitsInput } | { ok: false; message: string } {
  const allowed = ['unitIds', 'order', 'targetId', 'x', 'y', 'formation', 'stance'];
  if (!isRecord(input) || !exactKeys(input, allowed, ['unitIds', 'order'])) return { ok: false, message: 'Provide unitIds, order, and only the target fields needed by that order.' };
  if (!validIdList(input.unitIds) || typeof input.order !== 'string' || !['move', 'attack', 'attack_move', 'stop', 'hold_position', 'defend_area', 'retreat'].includes(input.order)) return { ok: false, message: 'Provide valid unitIds and order.' };
  if (input.order === 'attack' && (typeof input.targetId !== 'string' || input.targetId.length === 0)) return { ok: false, message: 'Attack orders require targetId.' };
  if (['move', 'attack_move', 'defend_area', 'retreat'].includes(input.order) && (typeof input.x !== 'number' || typeof input.y !== 'number' || !Number.isFinite(input.x) || !Number.isFinite(input.y))) return { ok: false, message: `${input.order} requires finite x and y coordinates.` };
  if (input.formation !== undefined && (typeof input.formation !== 'string' || !FORMATION_TYPES.includes(input.formation as FormationType))) return { ok: false, message: 'formation must be line, column, square, wedge, or loose.' };
  if (input.stance !== undefined && (typeof input.stance !== 'string' || !COMBAT_STANCES.includes(input.stance as CombatStance))) return { ok: false, message: 'stance must be aggressive, defensive, or hold_ground.' };
  return { ok: true, value: {
    unitIds: input.unitIds, order: input.order as OrderUnitsInput['order'],
    ...(typeof input.targetId === 'string' ? { targetId: input.targetId } : {}),
    ...(typeof input.x === 'number' ? { x: input.x } : {}), ...(typeof input.y === 'number' ? { y: input.y } : {}),
    ...(typeof input.formation === 'string' ? { formation: input.formation as FormationType } : {}),
    ...(typeof input.stance === 'string' ? { stance: input.stance as CombatStance } : {}),
  } };
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

    getCommandEntities() {
      activity.record('QUERY', 'Marshal inspected commandable forces and visible contacts.');
      try { return toolSuccess(queries.getCommandEntities(playerId)); }
      catch (error) { const result = queryFailure(error); activity.record('ERROR', result.error.message); return result; }
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


    async constructBuilding(input: unknown) {
      const validation = validateConstructBuildingInput(input);
      if (!validation.ok) return toolFailure('INVALID_INPUT', validation.message, ['Use get_command_entities to inspect villager IDs.']);
      const { buildingType, workerIds, x, y } = validation.value;
      activity.record('COMMAND', `Marshal: ${workerIds.length} villagers → build ${buildingType.replace('_', ' ')}.`);
      const result = await waitForResult(engine, engine.dispatch('webmcp', { type: 'place_building', playerId, buildingType, workerIds, position: { x, y } }));
      if (!result.ok) { activity.record('ERROR', result.message); return toolFailure(result.code, result.message, result.suggestions); }
      activity.record('SUCCESS', result.summary); return toolSuccess(result);
    },

    async trainUnit(input: unknown) {
      const validation = validateTrainUnitInput(input);
      if (!validation.ok) return toolFailure('INVALID_INPUT', validation.message, ['Use get_command_entities to inspect production buildings.']);
      activity.record('COMMAND', `Marshal: train ${validation.value.unitType.replace('_', ' ')}.`);
      const result = await waitForResult(engine, engine.dispatch('webmcp', { type: 'train_unit', playerId, ...validation.value }));
      if (!result.ok) { activity.record('ERROR', result.message); return toolFailure(result.code, result.message, result.suggestions); }
      activity.record('SUCCESS', result.summary); return toolSuccess(result);
    },

    async orderUnits(input: unknown) {
      const validation = validateOrderUnitsInput(input);
      if (!validation.ok) return toolFailure('INVALID_INPUT', validation.message, ['Use get_command_entities to inspect stable unit and target IDs.']);
      const value = validation.value;
      activity.record('COMMAND', `Marshal: ${value.unitIds.length} units → ${value.order.replace('_', ' ')}.`);
      if (value.order === 'attack' && !queries.getCommandEntities(playerId).visibleEnemies.some((enemy) => enemy.id === value.targetId)) {
        const message = 'Attack target is not currently visible to the Marshal.';
        activity.record('ERROR', message); return toolFailure('TARGET_NOT_VISIBLE', message, ['Use get_command_entities to inspect current visible contacts.']);
      }
      const payload = value.order === 'attack'
        ? { type: 'attack_target' as const, playerId, unitIds: value.unitIds, targetId: value.targetId ?? '' }
        : value.order === 'move'
          ? { type: 'move_units' as const, playerId, unitIds: value.unitIds, destination: { x: value.x ?? 0, y: value.y ?? 0 } }
          : {
              type: 'issue_unit_order' as const, playerId, unitIds: value.unitIds, order: value.order,
              ...(['stop', 'hold_position'].includes(value.order) ? {} : { destination: { x: value.x ?? 0, y: value.y ?? 0 } }),
              ...(value.formation === undefined ? {} : { formation: value.formation }),
              ...(value.stance === undefined ? {} : { stance: value.stance }),
            };
      const result = await waitForResult(engine, engine.dispatch('webmcp', payload));
      if (!result.ok) { activity.record('ERROR', result.message); return toolFailure(result.code, result.message, result.suggestions); }
      activity.record('SUCCESS', result.summary); return toolSuccess(result);
    },
  };
}
