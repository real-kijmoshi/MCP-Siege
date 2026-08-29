import { TICKS_PER_SECOND } from '../../game/config/battle';
import type { SimulationEngine } from '../../game/simulation/Engine';
import { GameQueries, QueryError } from '../../game/queries/GameQueries';
import type { CommandResult, GameCommandPayload, PlanModification } from '../../game/commands/types';
import {
  FORMATIONS,
  ORDER_KINDS,
  PLAN_ACTIONS,
  STANCES,
  UNIT_CATEGORIES,
  ZONE_IDS,
  type Formation,
  type OrderKind,
  type PlanAction,
  type PlanCondition,
  type PlanStep,
  type Stance,
  type ZoneId,
} from '../../game/types/domain';
import { toolFailure, toolSuccess, type ToolResult } from './results';
import {
  InputError,
  asObject,
  optionalEnum,
  optionalString,
  rejectUnknown,
  requireEnum,
  requireInteger,
  requireNumber,
  requireString,
  requireStringArray,
} from './validate';

/**
 * The tool surface.
 *
 * Reads go through `GameQueries`, so the Marshal is bound by the same fog of
 * war as the player. Writes dispatch ordinary commands onto the deterministic
 * queue and wait for the result the simulation actually produces; nothing here
 * touches game state directly, and nothing here can advance the clock.
 */

const PLAYER = 'player' as const;

/** Commands resolve on the next tick; give up rather than hang if paused. */
const COMMAND_TIMEOUT_MS = 4000;

export interface WebMcpToolHandlers {
  getBattleOverview: () => ToolResult<unknown>;
  getArmies: () => ToolResult<unknown>;
  getArmyDetails: (input: unknown) => ToolResult<unknown>;
  getVisibleEnemies: () => ToolResult<unknown>;
  getIntelligence: () => ToolResult<unknown>;
  getFrontStatus: () => ToolResult<unknown>;
  getAlerts: () => ToolResult<unknown>;
  getStrategicZones: () => ToolResult<unknown>;
  getActiveOrders: () => ToolResult<unknown>;
  getPlan: () => ToolResult<unknown>;
  getObjective: () => ToolResult<unknown>;

  orderGroup: (input: unknown) => Promise<ToolResult<unknown>>;
  reorganizeArmies: (input: unknown) => Promise<ToolResult<unknown>>;
  setConditionalOrder: (input: unknown) => Promise<ToolResult<unknown>>;
  cancelConditionalOrder: (input: unknown) => Promise<ToolResult<unknown>>;
  focusSiege: (input: unknown) => Promise<ToolResult<unknown>>;
  directReinforcements: (input: unknown) => Promise<ToolResult<unknown>>;

  createPlan: (input: unknown) => Promise<ToolResult<unknown>>;
  modifyPlan: (input: unknown) => Promise<ToolResult<unknown>>;
  executePlan: (input: unknown) => Promise<ToolResult<unknown>>;
  cancelPlan: (input: unknown) => Promise<ToolResult<unknown>>;
}

export interface ToolContext {
  engine: SimulationEngine;
  queries: GameQueries;
  /** Notifies the page that an order arrived from outside, for the toast. */
  onMarshalAction?: (summary: string) => void;
}

function readSafely<T>(read: () => T): ToolResult<T> {
  try {
    return toolSuccess(read());
  } catch (error) {
    if (error instanceof QueryError) return toolFailure(error.code, error.message);
    return toolFailure('QUERY_FAILED', error instanceof Error ? error.message : 'Query failed.');
  }
}

function parseCondition(raw: unknown): PlanCondition {
  const input = asObject(raw);
  const kind = requireEnum(input, 'kind', [
    'immediate',
    'after_step',
    'morale_below',
    'strength_below',
    'enemy_enters_zone',
    'friendly_zone_lost',
    'enemy_unit_type_visible',
    'timer_elapsed',
    'king_besieged',
  ] as const);

  switch (kind) {
    case 'immediate':
      rejectUnknown(input, ['kind']);
      return { kind };
    case 'after_step':
      rejectUnknown(input, ['kind', 'stepId']);
      return { kind, stepId: requireString(input, 'stepId', 64) };
    case 'morale_below':
      rejectUnknown(input, ['kind', 'groupId', 'value']);
      return {
        kind,
        groupId: requireString(input, 'groupId', 64),
        value: requireNumber(input, 'value', 0, 100),
      };
    case 'strength_below':
      rejectUnknown(input, ['kind', 'groupId', 'percent']);
      return {
        kind,
        groupId: requireString(input, 'groupId', 64),
        percent: requireNumber(input, 'percent', 0, 100),
      };
    case 'enemy_enters_zone':
      rejectUnknown(input, ['kind', 'zoneId']);
      return { kind, zoneId: requireEnum(input, 'zoneId', ZONE_IDS) };
    case 'friendly_zone_lost':
      rejectUnknown(input, ['kind', 'zoneId']);
      return { kind, zoneId: requireEnum(input, 'zoneId', ZONE_IDS) };
    case 'enemy_unit_type_visible': {
      rejectUnknown(input, ['kind', 'category', 'zoneId']);
      const zoneId = optionalEnum(input, 'zoneId', ZONE_IDS);
      return {
        kind,
        category: requireEnum(input, 'category', UNIT_CATEGORIES),
        ...(zoneId !== undefined ? { zoneId } : {}),
      };
    }
    case 'timer_elapsed':
      rejectUnknown(input, ['kind', 'seconds']);
      return { kind, seconds: requireNumber(input, 'seconds', 1, 1800) };
    case 'king_besieged':
      rejectUnknown(input, ['kind']);
      return { kind };
  }
}

const STEP_KEYS = [
  'groupId',
  'action',
  'targetZone',
  'targetGroupId',
  'formation',
  'stance',
  'startCondition',
  'note',
] as const;

function parseStep(raw: unknown): Omit<PlanStep, 'id' | 'index'> {
  const input = asObject(raw);
  rejectUnknown(input, STEP_KEYS);

  const targetZone = optionalEnum<ZoneId>(input, 'targetZone', ZONE_IDS);
  const targetGroupId = optionalString(input, 'targetGroupId', 64);
  const formation = optionalEnum<Formation>(input, 'formation', FORMATIONS);
  const stance = optionalEnum<Stance>(input, 'stance', STANCES);

  if (input.startCondition === undefined) {
    throw new InputError('Each step needs a startCondition.', [
      'Use {"kind":"immediate"} for steps that begin at once.',
    ]);
  }

  return {
    groupId: requireString(input, 'groupId', 64),
    action: requireEnum<PlanAction>(input, 'action', PLAN_ACTIONS),
    ...(targetZone !== undefined ? { targetZone } : {}),
    ...(targetGroupId !== undefined ? { targetGroupId } : {}),
    ...(formation !== undefined ? { formation } : {}),
    ...(stance !== undefined ? { stance } : {}),
    startCondition: parseCondition(input.startCondition),
    note: requireString(input, 'note', 200),
  };
}

export function createWebMcpToolHandlers(context: ToolContext): WebMcpToolHandlers {
  const { engine, queries } = context;

  /** Dispatches a command and resolves with the simulation's own verdict. */
  const submit = async (payload: GameCommandPayload): Promise<ToolResult<unknown>> => {
    const result = await new Promise<CommandResult | undefined>((resolve) => {
      const command = engine.dispatch('webmcp', payload);
      const timer = setTimeout(() => {
        unsubscribe();
        resolve(undefined);
      }, COMMAND_TIMEOUT_MS);

      const unsubscribe = engine.onCommandResult((issued, outcome) => {
        if (issued.id !== command.id) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(outcome);
      });
    });

    if (result === undefined) {
      return toolFailure(
        'SIMULATION_STALLED',
        'The order was queued but the battle did not advance in time.',
        ['The game may be paused. Resume it and try again.'],
      );
    }

    if (!result.ok) return toolFailure(result.code, result.message, result.suggestions);

    context.onMarshalAction?.(result.summary);
    return toolSuccess({
      ok: true,
      commandId: result.commandId,
      appliedAtTick: result.appliedAtTick,
      summary: result.summary,
      ...result.data,
    });
  };

  /** Converts thrown validation errors into structured failures. */
  const guarded = (
    run: (input: unknown) => Promise<ToolResult<unknown>>,
  ): ((input: unknown) => Promise<ToolResult<unknown>>) => {
    return async (input: unknown) => {
      try {
        return await run(input);
      } catch (error) {
        if (error instanceof InputError) {
          return toolFailure('INVALID_INPUT', error.message, error.suggestions);
        }
        return toolFailure(
          'TOOL_FAILED',
          error instanceof Error ? error.message : 'The tool failed.',
        );
      }
    };
  };

  return {
    /* ----------------------------------------------------------- reads */

    getBattleOverview: () => readSafely(() => queries.getBattleOverview(PLAYER)),
    getArmies: () => readSafely(() => ({ armies: queries.getArmies(PLAYER) })),

    getArmyDetails: (raw) => {
      try {
        const input = asObject(raw);
        rejectUnknown(input, ['groupId']);
        const groupId = requireString(input, 'groupId', 64);
        return readSafely(() => queries.getArmyDetails(PLAYER, groupId));
      } catch (error) {
        if (error instanceof InputError) {
          return toolFailure('INVALID_INPUT', error.message, error.suggestions);
        }
        return toolFailure('TOOL_FAILED', 'The tool failed.');
      }
    },

    getVisibleEnemies: () =>
      readSafely(() => ({
        note: 'Only forces currently in sight. Call get_intelligence for remembered contacts.',
        enemies: queries.getVisibleEnemies(PLAYER),
      })),

    getIntelligence: () =>
      readSafely(() => ({
        note:
          'Strength figures are estimates rounded to the nearest 25. Contacts not visible now ' +
          'are last-known positions and may be stale.',
        contacts: queries.getIntelligence(PLAYER),
      })),

    getFrontStatus: () => readSafely(() => ({ fronts: queries.getFrontStatus(PLAYER) })),
    getAlerts: () => readSafely(() => ({ alerts: queries.getAlerts(PLAYER) })),
    getStrategicZones: () => readSafely(() => ({ zones: queries.getStrategicZones(PLAYER) })),
    getActiveOrders: () => readSafely(() => queries.getActiveOrders(PLAYER)),

    getPlan: () =>
      readSafely(() => {
        const plan = queries.getCurrentPlan(PLAYER);
        return plan === undefined ? { plan: null, note: 'No plan has been drafted.' } : { plan };
      }),

    getObjective: () => readSafely(() => queries.getObjective(PLAYER)),

    /* -------------------------------------------------------- commands */

    orderGroup: guarded(async (raw) => {
      const input = asObject(raw);
      rejectUnknown(input, [
        'groupIds',
        'order',
        'targetZone',
        'targetGroupId',
        'formation',
        'stance',
      ]);

      const order = requireEnum<OrderKind>(
        input,
        'order',
        ORDER_KINDS.filter((kind) => kind !== 'idle') as OrderKind[],
      );
      const targetZone = optionalEnum<ZoneId>(input, 'targetZone', ZONE_IDS);
      const targetGroupId = optionalString(input, 'targetGroupId', 64);
      const formation = optionalEnum<Formation>(input, 'formation', FORMATIONS);
      const stance = optionalEnum<Stance>(input, 'stance', STANCES);

      return submit({
        type: 'order_groups',
        playerId: PLAYER,
        groupIds: requireStringArray(input, 'groupIds', 1, 12),
        order,
        ...(targetZone !== undefined ? { targetZone } : {}),
        ...(targetGroupId !== undefined ? { targetGroupId } : {}),
        ...(formation !== undefined ? { formation } : {}),
        ...(stance !== undefined ? { stance } : {}),
      });
    }),

    reorganizeArmies: guarded(async (raw) => {
      const input = asObject(raw);
      rejectUnknown(input, ['operation', 'groupId', 'groupIds', 'percent', 'name']);
      const operation = requireEnum(input, 'operation', ['split', 'merge', 'rename'] as const);

      if (operation === 'split') {
        return submit({
          type: 'split_group',
          playerId: PLAYER,
          groupId: requireString(input, 'groupId', 64),
          percent: requireInteger(input, 'percent', 1, 99),
          newGroupName: requireString(input, 'name', 40),
        });
      }

      if (operation === 'merge') {
        const name = optionalString(input, 'name', 40);
        return submit({
          type: 'merge_groups',
          playerId: PLAYER,
          groupIds: requireStringArray(input, 'groupIds', 2, 8),
          ...(name !== undefined ? { newGroupName: name } : {}),
        });
      }

      return submit({
        type: 'rename_group',
        playerId: PLAYER,
        groupId: requireString(input, 'groupId', 64),
        name: requireString(input, 'name', 40),
      });
    }),

    setConditionalOrder: guarded(async (raw) => {
      const input = asObject(raw);
      rejectUnknown(input, [
        'groupId',
        'action',
        'targetZone',
        'targetGroupId',
        'formation',
        'stance',
        'condition',
        'note',
      ]);

      const targetZone = optionalEnum<ZoneId>(input, 'targetZone', ZONE_IDS);
      const targetGroupId = optionalString(input, 'targetGroupId', 64);
      const formation = optionalEnum<Formation>(input, 'formation', FORMATIONS);
      const stance = optionalEnum<Stance>(input, 'stance', STANCES);

      if (input.condition === undefined) throw new InputError('A condition is required.');

      return submit({
        type: 'set_conditional_order',
        playerId: PLAYER,
        groupId: requireString(input, 'groupId', 64),
        action: requireEnum<PlanAction>(input, 'action', PLAN_ACTIONS),
        ...(targetZone !== undefined ? { targetZone } : {}),
        ...(targetGroupId !== undefined ? { targetGroupId } : {}),
        ...(formation !== undefined ? { formation } : {}),
        ...(stance !== undefined ? { stance } : {}),
        condition: parseCondition(input.condition),
        note: optionalString(input, 'note', 200) ?? '',
      });
    }),

    cancelConditionalOrder: guarded(async (raw) => {
      const input = asObject(raw);
      rejectUnknown(input, ['conditionalId']);
      return submit({
        type: 'cancel_conditional_order',
        playerId: PLAYER,
        conditionalId: requireString(input, 'conditionalId', 64),
      });
    }),

    focusSiege: guarded(async (raw) => {
      const input = asObject(raw);
      rejectUnknown(input, ['siegeGroupId', 'targetZone']);
      return submit({
        type: 'focus_siege',
        playerId: PLAYER,
        siegeGroupId: requireString(input, 'siegeGroupId', 64),
        targetZone: requireEnum<ZoneId>(input, 'targetZone', ZONE_IDS),
      });
    }),

    directReinforcements: guarded(async (raw) => {
      const input = asObject(raw);
      rejectUnknown(input, ['targetZone', 'targetGroupId']);
      const targetZone = optionalEnum<ZoneId>(input, 'targetZone', ZONE_IDS);
      const targetGroupId = optionalString(input, 'targetGroupId', 64);
      return submit({
        type: 'direct_reinforcements',
        playerId: PLAYER,
        ...(targetZone !== undefined ? { targetZone } : {}),
        ...(targetGroupId !== undefined ? { targetGroupId } : {}),
      });
    }),

    /* ------------------------------------------------------------ plans */

    createPlan: guarded(async (raw) => {
      const input = asObject(raw);
      rejectUnknown(input, ['name', 'steps']);
      const steps = input.steps;
      if (!Array.isArray(steps) || steps.length === 0) {
        throw new InputError('"steps" must be a non-empty array of plan steps.');
      }
      if (steps.length > 20) throw new InputError('A plan is limited to 20 steps.');

      return submit({
        type: 'create_plan',
        playerId: PLAYER,
        name: requireString(input, 'name', 60),
        steps: steps.map(parseStep),
      });
    }),

    modifyPlan: guarded(async (raw) => {
      const input = asObject(raw);
      rejectUnknown(input, ['planId', 'modifications']);
      const raws = input.modifications;
      if (!Array.isArray(raws) || raws.length === 0) {
        throw new InputError('"modifications" must be a non-empty array.');
      }

      const modifications: PlanModification[] = raws.map((entry) => {
        const modification = asObject(entry);
        const operation = requireEnum(modification, 'operation', [
          'add_step',
          'remove_step',
          'replace_step',
          'move_step',
          'rename',
        ] as const);

        switch (operation) {
          case 'add_step': {
            rejectUnknown(modification, ['operation', 'step', 'atIndex']);
            const atIndex =
              modification.atIndex === undefined
                ? undefined
                : requireInteger(modification, 'atIndex', 0, 20);
            return {
              operation,
              step: parseStep(modification.step),
              ...(atIndex !== undefined ? { atIndex } : {}),
            };
          }
          case 'remove_step':
            rejectUnknown(modification, ['operation', 'stepId']);
            return { operation, stepId: requireString(modification, 'stepId', 64) };
          case 'replace_step':
            rejectUnknown(modification, ['operation', 'stepId', 'step']);
            return {
              operation,
              stepId: requireString(modification, 'stepId', 64),
              step: parseStep(modification.step),
            };
          case 'move_step':
            rejectUnknown(modification, ['operation', 'stepId', 'toIndex']);
            return {
              operation,
              stepId: requireString(modification, 'stepId', 64),
              toIndex: requireInteger(modification, 'toIndex', 0, 20),
            };
          case 'rename':
            rejectUnknown(modification, ['operation', 'name']);
            return { operation, name: requireString(modification, 'name', 60) };
        }
      });

      return submit({
        type: 'modify_plan',
        playerId: PLAYER,
        planId: requireString(input, 'planId', 64),
        modifications,
      });
    }),

    executePlan: guarded(async (raw) => {
      const input = asObject(raw);
      rejectUnknown(input, ['planId']);
      return submit({
        type: 'execute_plan',
        playerId: PLAYER,
        planId: requireString(input, 'planId', 64),
      });
    }),

    cancelPlan: guarded(async (raw) => {
      const input = asObject(raw);
      rejectUnknown(input, ['planId']);
      return submit({
        type: 'cancel_plan',
        playerId: PLAYER,
        planId: requireString(input, 'planId', 64),
      });
    }),
  };
}

export { TICKS_PER_SECOND };
