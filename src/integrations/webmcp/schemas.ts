import {
  FORMATIONS,
  ORDER_KINDS,
  PLAN_ACTIONS,
  STANCES,
  UNIT_CATEGORIES,
  ZONE_IDS,
  type ZoneId,
} from '../../game/types/domain';

/**
 * Tool input schemas.
 *
 * Every schema is strict (`additionalProperties: false`) and every location is
 * a named zone rather than a coordinate, so the Marshal reasons about "the
 * central bridge" and cannot address arbitrary points on the map.
 *
 * They are built per battle rather than declared once, because the zone enum
 * has to be the ground actually in front of the caller. Offering it every name
 * in the game and rejecting most of them at runtime would be a schema that
 * misinforms, which is worse than no schema at all.
 */

export const EMPTY_INPUT_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const;

export function createToolSchemas(zoneIds: readonly ZoneId[] = ZONE_IDS) {
  const groupIdSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 64,
    description: 'Stable group id from get_armies, for example "legion_i".',
  } as const;

  const zoneSchema = {
    type: 'string',
    enum: zoneIds,
    description: 'A named strategic zone on this battlefield. Call get_strategic_zones for the map.',
  } as const;

  const formationSchema = {
    type: 'string',
    enum: FORMATIONS,
    description:
      'line (wide frontage), column (fast, narrow), block (stable), wedge (shock charge), ' +
      'double_line (broad with a second rank), loose (resists arrows and siege), ' +
      'square (strong against cavalry, very slow).',
  } as const;

  const stanceSchema = {
    type: 'string',
    enum: STANCES,
    description: 'aggressive, defensive, or hold_ground.',
  } as const;

  /**
   * The closed trigger vocabulary. Conditions are data, never code, which is what
   * makes it safe to let an external agent arm standing orders.
   */
  const CONDITION_SCHEMA = {
    type: 'object',
    description: 'A trigger drawn from a fixed vocabulary.',
    oneOf: [
      {
        type: 'object',
        properties: { kind: { const: 'immediate' } },
        required: ['kind'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          kind: { const: 'after_step' },
          stepId: { type: 'string', minLength: 1 },
        },
        required: ['kind', 'stepId'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          kind: { const: 'morale_below' },
          groupId: groupIdSchema,
          value: { type: 'number', minimum: 0, maximum: 100 },
        },
        required: ['kind', 'groupId', 'value'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          kind: { const: 'strength_below' },
          groupId: groupIdSchema,
          percent: { type: 'number', minimum: 0, maximum: 100 },
        },
        required: ['kind', 'groupId', 'percent'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: { kind: { const: 'enemy_enters_zone' }, zoneId: zoneSchema },
        required: ['kind', 'zoneId'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: { kind: { const: 'friendly_zone_lost' }, zoneId: zoneSchema },
        required: ['kind', 'zoneId'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          kind: { const: 'enemy_unit_type_visible' },
          category: { type: 'string', enum: UNIT_CATEGORIES },
          zoneId: zoneSchema,
        },
        required: ['kind', 'category'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          kind: { const: 'timer_elapsed' },
          seconds: { type: 'number', minimum: 1, maximum: 1800 },
        },
        required: ['kind', 'seconds'],
        additionalProperties: false,
      },
      {
        type: 'object',
        description: 'Fires while your own king is under threat of capture.',
        properties: { kind: { const: 'king_besieged' } },
        required: ['kind'],
        additionalProperties: false,
      },
    ],
  } as const;

  const ARMY_DETAILS_SCHEMA = {
    type: 'object',
    properties: { groupId: groupIdSchema },
    required: ['groupId'],
    additionalProperties: false,
  } as const;

  const groupIdsSchema = {
    type: 'array',
    items: groupIdSchema,
    minItems: 1,
    maxItems: 12,
    uniqueItems: true,
    description: 'One or more of your own groups from get_armies.',
  } as const;
  const commonOrderProperties = {
    groupIds: groupIdsSchema,
    formation: formationSchema,
    stance: stanceSchema,
  } as const;
  const targetGroupSchema = {
    ...groupIdSchema,
    description: 'A friendly id from get_armies for support, or a known enemy id from get_intelligence.',
  } as const;

  // Discriminated branches prevent the most common tool failure: a syntactic
  // order whose target field does not match its action.
  const ORDER_GROUP_SCHEMA = {
    type: 'object',
    oneOf: [
      ...(['move', 'attack_zone', 'defend_zone', 'scout'] as const).map((order) => ({
        type: 'object',
        properties: { ...commonOrderProperties, order: { const: order }, targetZone: zoneSchema },
        required: ['groupIds', 'order', 'targetZone'],
        additionalProperties: false,
      })),
      ...(['attack_group', 'support'] as const).map((order) => ({
        type: 'object',
        properties: {
          ...commonOrderProperties,
          order: { const: order },
          targetGroupId: targetGroupSchema,
        },
        required: ['groupIds', 'order', 'targetGroupId'],
        additionalProperties: false,
      })),
      ...(['hold', 'retreat'] as const).map((order) => ({
        type: 'object',
        properties: { ...commonOrderProperties, order: { const: order } },
        required: ['groupIds', 'order'],
        additionalProperties: false,
      })),
    ],
  } as const;

  const REORGANIZE_SCHEMA = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['split', 'merge', 'rename'],
        description: 'split detaches part of a group; merge fuses groups; rename relabels one.',
      },
      groupId: { ...groupIdSchema, description: 'The group to split or rename.' },
      groupIds: {
        type: 'array',
        items: groupIdSchema,
        minItems: 2,
        maxItems: 8,
        uniqueItems: true,
        description: 'Groups to merge. The first absorbs the rest.',
      },
      percent: {
        type: 'integer',
        minimum: 1,
        maximum: 99,
        description: 'Share of the group moved into the detachment when splitting.',
      },
      name: {
        type: 'string',
        minLength: 1,
        maxLength: 40,
        description: 'Name for the new detachment, the merged group, or the renamed group.',
      },
    },
    required: ['operation'],
    additionalProperties: false,
  } as const;

  const SET_CONDITIONAL_SCHEMA = {
    type: 'object',
    properties: {
      groupId: groupIdSchema,
      action: { type: 'string', enum: PLAN_ACTIONS },
      targetZone: zoneSchema,
      targetGroupId: groupIdSchema,
      formation: formationSchema,
      stance: stanceSchema,
      condition: CONDITION_SCHEMA,
      note: { type: 'string', maxLength: 200, description: 'Why this order is armed.' },
    },
    required: ['groupId', 'action', 'condition'],
    additionalProperties: false,
  } as const;

  const CANCEL_CONDITIONAL_SCHEMA = {
    type: 'object',
    properties: {
      conditionalId: { type: 'string', minLength: 1, description: 'Id from get_active_orders.' },
    },
    required: ['conditionalId'],
    additionalProperties: false,
  } as const;

  const FOCUS_SIEGE_SCHEMA = {
    type: 'object',
    properties: {
      siegeGroupId: { ...groupIdSchema, description: 'A group containing siege engines.' },
      targetZone: zoneSchema,
    },
    required: ['siegeGroupId', 'targetZone'],
    additionalProperties: false,
  } as const;

  const DIRECT_REINFORCEMENTS_SCHEMA = {
    type: 'object',
    properties: {
      targetZone: zoneSchema,
      targetGroupId: { ...groupIdSchema, description: 'Send the new wave to support this group.' },
    },
    additionalProperties: false,
  } as const;

  const PLAN_STEP_SCHEMA = {
    type: 'object',
    properties: {
      groupId: groupIdSchema,
      action: { type: 'string', enum: PLAN_ACTIONS },
      targetZone: zoneSchema,
      targetGroupId: groupIdSchema,
      formation: formationSchema,
      stance: stanceSchema,
      startCondition: CONDITION_SCHEMA,
      note: {
        type: 'string',
        maxLength: 200,
        description: 'Short description shown on the battlefield overlay.',
      },
    },
    required: ['groupId', 'action'],
    additionalProperties: false,
  } as const;

  const CREATE_PLAN_SCHEMA = {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        minLength: 1,
        maxLength: 60,
        description: 'Operation name, for example "Operation Iron Crossing".',
      },
      steps: { type: 'array', items: PLAN_STEP_SCHEMA, minItems: 1, maxItems: 20 },
    },
    required: ['name', 'steps'],
    additionalProperties: false,
  } as const;

  const MODIFY_PLAN_SCHEMA = {
    type: 'object',
    properties: {
      planId: { type: 'string', minLength: 1 },
      modifications: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          oneOf: [
            {
              type: 'object',
              properties: {
                operation: { const: 'add_step' },
                step: PLAN_STEP_SCHEMA,
                atIndex: { type: 'integer', minimum: 0, maximum: 20 },
              },
              required: ['operation', 'step'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                operation: { const: 'remove_step' },
                stepId: { type: 'string', minLength: 1 },
              },
              required: ['operation', 'stepId'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                operation: { const: 'replace_step' },
                stepId: { type: 'string', minLength: 1 },
                step: PLAN_STEP_SCHEMA,
              },
              required: ['operation', 'stepId', 'step'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                operation: { const: 'move_step' },
                stepId: { type: 'string', minLength: 1 },
                toIndex: { type: 'integer', minimum: 0, maximum: 20 },
              },
              required: ['operation', 'stepId', 'toIndex'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                operation: { const: 'rename' },
                name: { type: 'string', minLength: 1, maxLength: 60 },
              },
              required: ['operation', 'name'],
              additionalProperties: false,
            },
          ],
        },
      },
    },
    required: ['planId', 'modifications'],
    additionalProperties: false,
  } as const;

  const PLAN_ID_SCHEMA = {
    type: 'object',
    properties: { planId: { type: 'string', minLength: 1, description: 'Id from get_plan.' } },
    required: ['planId'],
    additionalProperties: false,
  } as const;

  return {
    ARMY_DETAILS_SCHEMA,
    CANCEL_CONDITIONAL_SCHEMA,
    CONDITION_SCHEMA,
    CREATE_PLAN_SCHEMA,
    DIRECT_REINFORCEMENTS_SCHEMA,
    FOCUS_SIEGE_SCHEMA,
    MODIFY_PLAN_SCHEMA,
    ORDER_GROUP_SCHEMA,
    PLAN_ID_SCHEMA,
    REORGANIZE_SCHEMA,
    SET_CONDITIONAL_SCHEMA,
  };
}

export type ToolSchemas = ReturnType<typeof createToolSchemas>;
