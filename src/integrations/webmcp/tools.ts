import { TICKS_PER_SECOND } from '../../game/config/battle';
import type { SimulationEngine } from '../../game/simulation/Engine';
import { activeZoneIds, useBattleMap } from '../../game/simulation/Zones';
import { GameQueries, QueryError } from '../../game/queries/GameQueries';
import { AssessmentError, type EngagementInput } from '../../game/queries/Assessment';
import { MarchError } from '../../game/queries/March';
import type { Doctrine } from '../../game/queries/Doctrine';
import {
  createBattleWatch,
  MAXIMUM_WATCH_CONDITIONS,
  MAXIMUM_WATCH_SECONDS,
  MINIMUM_WATCH_SECONDS,
} from './watch';
import type {
  CommandResult,
  FormationAssignment,
  GameCommandPayload,
  PlanModification,
} from '../../game/commands/types';
import {
  FORMATIONS,
  ORDER_KINDS,
  PLAN_ACTIONS,
  STANCES,
  TACTICAL_SLOTS,
  UNIT_CATEGORIES,
  type Formation,
  type OrderKind,
  type PlanAction,
  type PlanCondition,
  type PlanStep,
  type Stance,
  type TacticalSlot,
  type UnitCategory,
  type ZoneId,
} from '../../game/types/domain';
import { toolFailure, toolSuccess, type ToolResult } from './results';
import {
  InputError,
  asObject,
  optionalBoolean,
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
  getDoctrine: (input: unknown) => ToolResult<unknown>;
  assessEngagement: (input: unknown) => ToolResult<unknown>;
  estimateMarch: (input: unknown) => ToolResult<unknown>;

  watchBattle: (input: unknown) => Promise<ToolResult<unknown>>;

  orderGroup: (input: unknown) => Promise<ToolResult<unknown>>;
  reorganizeArmies: (input: unknown) => Promise<ToolResult<unknown>>;
  setConditionalOrder: (input: unknown) => Promise<ToolResult<unknown>>;
  cancelConditionalOrder: (input: unknown) => Promise<ToolResult<unknown>>;
  focusSiege: (input: unknown) => Promise<ToolResult<unknown>>;
  directReinforcements: (input: unknown) => Promise<ToolResult<unknown>>;
  deployFormation: (input: unknown) => Promise<ToolResult<unknown>>;

  createPlan: (input: unknown) => Promise<ToolResult<unknown>>;
  modifyPlan: (input: unknown) => Promise<ToolResult<unknown>>;
  executePlan: (input: unknown) => Promise<ToolResult<unknown>>;
  cancelPlan: (input: unknown) => Promise<ToolResult<unknown>>;
}

export interface ToolContext {
  engine: SimulationEngine;
  queries: GameQueries;
  /** Notifies the page that an order arrived from outside, for the toast. */
  onMarshalAction?: (summary: string, commandType: GameCommandPayload['type']) => void;
}

function readSafely<T>(read: () => T): ToolResult<T> {
  try {
    return toolSuccess(read());
  } catch (error) {
    // Every refusal carries its own reason and, where there is one, the move
    // that would make the call succeed. A Marshal that is told only "failed"
    // guesses again; one that is told "scout it first" scouts.
    if (error instanceof QueryError) return toolFailure(error.code, error.message);
    if (error instanceof AssessmentError || error instanceof MarchError) {
      return toolFailure(error.code, error.message, error.suggestions);
    }
    if (error instanceof InputError) {
      return toolFailure('INVALID_INPUT', error.message, error.suggestions);
    }
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
      return { kind, zoneId: requireEnum(input, 'zoneId', activeZoneIds()) };
    case 'friendly_zone_lost':
      rejectUnknown(input, ['kind', 'zoneId']);
      return { kind, zoneId: requireEnum(input, 'zoneId', activeZoneIds()) };
    case 'enemy_unit_type_visible': {
      rejectUnknown(input, ['kind', 'category', 'zoneId']);
      const zoneId = optionalEnum(input, 'zoneId', activeZoneIds());
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

  const targetZone = optionalEnum<ZoneId>(input, 'targetZone', activeZoneIds());
  const targetGroupId = optionalString(input, 'targetGroupId', 64);
  const formation = optionalEnum<Formation>(input, 'formation', FORMATIONS);
  const stance = optionalEnum<Stance>(input, 'stance', STANCES);

  const action = requireEnum<PlanAction>(input, 'action', PLAN_ACTIONS);

  return {
    groupId: requireString(input, 'groupId', 64),
    action,
    ...(targetZone !== undefined ? { targetZone } : {}),
    ...(targetGroupId !== undefined ? { targetGroupId } : {}),
    ...(formation !== undefined ? { formation } : {}),
    ...(stance !== undefined ? { stance } : {}),
    startCondition:
      input.startCondition === undefined ? { kind: 'immediate' } : parseCondition(input.startCondition),
    note: optionalString(input, 'note', 200) ?? action.replace('_', ' '),
  };
}

export function createWebMcpToolHandlers(context: ToolContext): WebMcpToolHandlers {
  const { engine, queries } = context;
  const watch = createBattleWatch(engine, queries, PLAYER);

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

    context.onMarshalAction?.(result.summary, payload.type);
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
        // Named locations are validated against the map this battle is on, so a
        // zone from a different battlefield is refused rather than marched to.
        useBattleMap(engine.getState().mapId);
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

    /* ------------------------------------------- the Marshal's instruments */

    getDoctrine: (raw) =>
      readSafely(() => {
        const input = asObject(raw ?? {});
        rejectUnknown(input, ['sections']);
        const doctrine = queries.getDoctrine();
        if (input.sections === undefined) return doctrine;

        const sections = requireStringArray(input, 'sections', 1, 6);
        const allowed: Array<keyof Doctrine> = [
          'arms',
          'formations',
          'stances',
          'terrain',
          'mechanics',
          'playbook',
        ];
        const filtered: Partial<Doctrine> & { note: string } = { note: doctrine.note };
        for (const section of sections) {
          if (!(allowed as string[]).includes(section)) {
            throw new InputError(`"${section}" is not part of the manual.`, [
              `Sections: ${allowed.join(', ')}.`,
            ]);
          }
          Object.assign(filtered, { [section]: doctrine[section as keyof Doctrine] });
        }
        return filtered;
      }),

    assessEngagement: (raw) =>
      readSafely(() => {
        useBattleMap(engine.getState().mapId);
        const input = asObject(raw);
        rejectUnknown(input, ['groupIds', 'targetGroupId', 'targetZone']);
        const targetGroupId = optionalString(input, 'targetGroupId', 64);
        const targetZone = optionalEnum<ZoneId>(input, 'targetZone', activeZoneIds());
        if ((targetGroupId === undefined) === (targetZone === undefined)) {
          throw new InputError('Give exactly one of targetGroupId or targetZone.', [
            'Call get_intelligence for enemy ids, or get_strategic_zones for ground.',
          ]);
        }
        const request: EngagementInput = {
          groupIds: requireStringArray(input, 'groupIds', 1, 8),
          ...(targetGroupId !== undefined ? { targetGroupId } : {}),
          ...(targetZone !== undefined ? { targetZone } : {}),
        };
        return queries.assessEngagement(PLAYER, request);
      }),

    estimateMarch: (raw) =>
      readSafely(() => {
        useBattleMap(engine.getState().mapId);
        const input = asObject(raw);
        rejectUnknown(input, ['groupIds', 'targetZone']);
        const targetZone = requireEnum<ZoneId>(input, 'targetZone', activeZoneIds());
        const groupIds =
          input.groupIds === undefined ? [] : requireStringArray(input, 'groupIds', 0, 12);
        return queries.estimateMarch(PLAYER, groupIds, targetZone);
      }),

    /**
     * The one read that takes time.
     *
     * It resolves the moment something the caller named happens rather than on
     * a guess about how long to sleep, so an agent stops burning its turns on
     * pictures that have not changed.
     */
    watchBattle: async (raw) => {
      try {
        useBattleMap(engine.getState().mapId);
        const input = asObject(raw);
        rejectUnknown(input, ['conditions', 'timeoutSeconds']);

        const rawConditions = input.conditions;
        if (
          !Array.isArray(rawConditions) ||
          rawConditions.length < 1 ||
          rawConditions.length > MAXIMUM_WATCH_CONDITIONS
        ) {
          throw new InputError(
            `"conditions" must contain between 1 and ${MAXIMUM_WATCH_CONDITIONS} triggers.`,
          );
        }

        const conditions = rawConditions.map((entry) => {
          const condition = parseCondition(entry);
          if (condition.kind === 'immediate' || condition.kind === 'after_step') {
            throw new InputError(`"${condition.kind}" is not something to wait for.`, [
              'Wait on morale_below, strength_below, enemy_enters_zone, friendly_zone_lost, ' +
                'enemy_unit_type_visible, timer_elapsed or king_besieged.',
            ]);
          }
          return condition;
        });

        const result = await watch({
          conditions,
          timeoutSeconds: requireNumber(
            input,
            'timeoutSeconds',
            MINIMUM_WATCH_SECONDS,
            MAXIMUM_WATCH_SECONDS,
          ),
        });
        return toolSuccess(result);
      } catch (error) {
        if (error instanceof InputError) {
          return toolFailure('INVALID_INPUT', error.message, error.suggestions);
        }
        return toolFailure(
          'TOOL_FAILED',
          error instanceof Error ? error.message : 'The tool failed.',
        );
      }
    },

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
        'append',
      ]);

      const order = requireEnum<OrderKind>(
        input,
        'order',
        ORDER_KINDS.filter((kind) => kind !== 'idle') as OrderKind[],
      );
      const targetZone = optionalEnum<ZoneId>(input, 'targetZone', activeZoneIds());
      const targetGroupId = optionalString(input, 'targetGroupId', 64);
      const formation = optionalEnum<Formation>(input, 'formation', FORMATIONS);
      const stance = optionalEnum<Stance>(input, 'stance', STANCES);
      const append = optionalBoolean(input, 'append');

      const zoneOrders: readonly OrderKind[] = ['move', 'attack_zone', 'defend_zone', 'scout'];
      const groupOrders: readonly OrderKind[] = ['attack_group', 'support'];
      if (zoneOrders.includes(order)) {
        if (targetZone === undefined || targetGroupId !== undefined) {
          throw new InputError(`Order "${order}" requires targetZone and no targetGroupId.`, [
            'Call get_strategic_zones for valid targetZone values.',
          ]);
        }
      } else if (groupOrders.includes(order)) {
        if (targetGroupId === undefined || targetZone !== undefined) {
          throw new InputError(`Order "${order}" requires targetGroupId and no targetZone.`, [
            order === 'support'
              ? 'Call get_armies for friendly group ids.'
              : 'Call get_intelligence for known enemy group ids.',
          ]);
        }
      } else if (targetZone !== undefined || targetGroupId !== undefined) {
        throw new InputError(`Order "${order}" does not take a target.`, [
          'Use hold or retreat with only groupIds, plus optional formation or stance.',
        ]);
      }
      if (append === true && (order === 'hold' || order === 'retreat')) {
        throw new InputError(`Order "${order}" cannot be queued as a waypoint.`, [
          'Queue move, attack, defend, scout, or support orders instead.',
        ]);
      }

      return submit({
        type: 'order_groups',
        playerId: PLAYER,
        groupIds: requireStringArray(input, 'groupIds', 1, 12),
        order,
        ...(targetZone !== undefined ? { targetZone } : {}),
        ...(targetGroupId !== undefined ? { targetGroupId } : {}),
        ...(formation !== undefined ? { formation } : {}),
        ...(stance !== undefined ? { stance } : {}),
        ...(append !== undefined ? { append } : {}),
      });
    }),

    reorganizeArmies: guarded(async (raw) => {
      const input = asObject(raw);
      rejectUnknown(input, ['operation', 'groupId', 'groupIds', 'category', 'percent', 'name']);
      const operation = requireEnum(input, 'operation', ['split', 'detach', 'merge', 'rename'] as const);

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

      if (operation === 'detach') {
        return submit({
          type: 'detach_category',
          playerId: PLAYER,
          groupId: requireString(input, 'groupId', 64),
          category: requireEnum<UnitCategory>(input, 'category', UNIT_CATEGORIES),
          percent: requireInteger(input, 'percent', 1, 100),
          newGroupName: requireString(input, 'name', 40),
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

      const targetZone = optionalEnum<ZoneId>(input, 'targetZone', activeZoneIds());
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
        targetZone: requireEnum<ZoneId>(input, 'targetZone', activeZoneIds()),
      });
    }),

    directReinforcements: guarded(async (raw) => {
      const input = asObject(raw);
      rejectUnknown(input, ['targetZone', 'targetGroupId']);
      const targetZone = optionalEnum<ZoneId>(input, 'targetZone', activeZoneIds());
      const targetGroupId = optionalString(input, 'targetGroupId', 64);
      return submit({
        type: 'direct_reinforcements',
        playerId: PLAYER,
        ...(targetZone !== undefined ? { targetZone } : {}),
        ...(targetGroupId !== undefined ? { targetGroupId } : {}),
      });
    }),

    deployFormation: guarded(async (raw) => {
      const input = asObject(raw);
      rejectUnknown(input, ['targetZone', 'assignments']);
      const rawAssignments = input.assignments;
      if (!Array.isArray(rawAssignments) || rawAssignments.length < 1 || rawAssignments.length > 14) {
        throw new InputError('"assignments" must contain between 1 and 14 regiment assignments.');
      }

      const assignments: FormationAssignment[] = rawAssignments.map((rawAssignment) => {
        const assignment = asObject(rawAssignment);
        rejectUnknown(assignment, ['groupId', 'slot', 'order', 'formation', 'stance']);
        const formation = optionalEnum<Formation>(assignment, 'formation', FORMATIONS);
        const stance = optionalEnum<Stance>(assignment, 'stance', STANCES);
        return {
          groupId: requireString(assignment, 'groupId', 64),
          slot: requireEnum<TacticalSlot>(assignment, 'slot', TACTICAL_SLOTS),
          order: requireEnum(assignment, 'order', ['move', 'attack_zone', 'defend_zone'] as const),
          ...(formation !== undefined ? { formation } : {}),
          ...(stance !== undefined ? { stance } : {}),
        };
      });

      return submit({
        type: 'deploy_formation',
        playerId: PLAYER,
        targetZone: requireEnum<ZoneId>(input, 'targetZone', activeZoneIds()),
        assignments,
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
