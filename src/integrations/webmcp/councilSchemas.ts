import { BATTLE_MAP_IDS } from '../../game/config/maps';
import { CUSTOM_LIMITS, SCRIPTABLE_ORDERS } from '../../game/config/customBattle';
import { AUTHORED_SCENARIO_IDS, DIFFICULTY_IDS } from '../../game/config/matches';
import {
  FORMATIONS,
  STANCES,
  UNIT_CATEGORIES,
  ZONE_IDS,
} from '../../game/types/domain';

/**
 * War Council input schemas.
 *
 * These belong to the screen before the battle, where there is no simulation to
 * protect and nothing to hide: the whole point of the surface is that a Marshal
 * can read every battlefield in the game and write an operation of its own on
 * one of them.
 *
 * Ground is still named rather than measured. The zone enum here is every zone
 * in the game because the map is itself an input; a name that is not on the
 * chosen map is refused at runtime, with the map's own ground listed back.
 */

const mapIdSchema = {
  type: 'string',
  enum: BATTLE_MAP_IDS,
  description: 'A battlefield. Call describe_battlefield for its ground before designing on it.',
} as const;

const zoneSchema = {
  type: 'string',
  enum: ZONE_IDS,
  description:
    'Named ground. It must be on the operation’s own map — describe_battlefield lists it.',
} as const;

const troopsSchema = {
  type: 'array',
  minItems: 1,
  maxItems: UNIT_CATEGORIES.length,
  description:
    'What the regiment is made of. infantry hold a line, spearman beat cavalry, archer shoot ' +
    'at range and fold in melee, cavalry break formations from the flank, heavy_infantry are ' +
    'slow and very hard, siege outranges everything and is helpless up close, scout sees far.',
  items: {
    type: 'object',
    properties: {
      category: { type: 'string', enum: UNIT_CATEGORIES },
      count: {
        type: 'integer',
        minimum: 1,
        maximum: CUSTOM_LIMITS.maxRegimentStrength,
      },
    },
    required: ['category', 'count'],
    additionalProperties: false,
  },
} as const;

const regimentSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      pattern: '^[a-z][a-z0-9_]{1,30}$',
      description: 'Lowercase slug, unique on its side. This becomes the group id in play.',
    },
    name: { type: 'string', minLength: 1, maxLength: CUSTOM_LIMITS.maxNameLength },
    zone: zoneSchema,
    troops: troopsSchema,
    formation: { type: 'string', enum: FORMATIONS },
    stance: { type: 'string', enum: STANCES },
    carriesKing: {
      type: 'boolean',
      description:
        'Exactly one regiment per side must carry its king. Taking a king wins the battle, so ' +
        'this regiment is the objective standing on the field.',
    },
  },
  required: ['id', 'name', 'zone', 'troops'],
  additionalProperties: false,
} as const;

const armySchema = {
  type: 'array',
  minItems: CUSTOM_LIMITS.minRegimentsPerSide,
  maxItems: CUSTOM_LIMITS.maxRegimentsPerSide,
  items: regimentSchema,
} as const;

export const DESCRIBE_BATTLEFIELD_SCHEMA = {
  type: 'object',
  properties: { mapId: mapIdSchema },
  required: ['mapId'],
  additionalProperties: false,
} as const;

export const DESIGN_OPERATION_SCHEMA = {
  type: 'object',
  description:
    'A whole battle: a battlefield, two armies placed on named ground, and a timetable for the ' +
    'enemy commander. Nothing is fought until launch_operation is called.',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: CUSTOM_LIMITS.maxNameLength },
    mapId: mapIdSchema,
    summary: { type: 'string', maxLength: CUSTOM_LIMITS.maxTextLength },
    briefingLine: { type: 'string', maxLength: CUSTOM_LIMITS.maxTextLength },
    twist: { type: 'string', maxLength: CUSTOM_LIMITS.maxTextLength },
    objective: { type: 'string', maxLength: CUSTOM_LIMITS.maxTextLength },
    playerArmyName: { type: 'string', maxLength: CUSTOM_LIMITS.maxNameLength },
    enemyArmyName: { type: 'string', maxLength: CUSTOM_LIMITS.maxNameLength },
    playerKingName: { type: 'string', maxLength: CUSTOM_LIMITS.maxNameLength },
    enemyKingName: { type: 'string', maxLength: CUSTOM_LIMITS.maxNameLength },
    playerRegiments: armySchema,
    enemyRegiments: armySchema,
    enemyPlan: {
      type: 'array',
      maxItems: CUSTOM_LIMITS.maxScriptedOrders,
      description:
        'The enemy commander, written as a timetable. Each entry fires once, at its second, on ' +
        'the difficulty’s own clock. A reactive layer answers what the player does; this is ' +
        'what gives the battle its shape.',
      items: {
        type: 'object',
        properties: {
          atSeconds: { type: 'integer', minimum: 0, maximum: CUSTOM_LIMITS.maxScriptSeconds },
          groupId: { type: 'string', description: 'An id from enemyRegiments.' },
          order: { type: 'string', enum: SCRIPTABLE_ORDERS },
          targetZone: zoneSchema,
          formation: { type: 'string', enum: FORMATIONS },
          stance: { type: 'string', enum: STANCES },
        },
        required: ['atSeconds', 'groupId', 'order'],
        additionalProperties: false,
      },
    },
  },
  required: ['name', 'mapId', 'playerRegiments', 'enemyRegiments'],
  additionalProperties: false,
} as const;

const operationChoiceSchema = {
  type: 'string',
  enum: [...AUTHORED_SCENARIO_IDS, 'custom'],
  description: 'One of the authored operations, or "custom" for the designed one on the table.',
} as const;

const difficultySchema = {
  type: 'string',
  enum: DIFFICULTY_IDS,
  description: 'levy is forgiving, captain is the intended tempo, warlord is relentless.',
} as const;

export const SELECT_OPERATION_SCHEMA = {
  type: 'object',
  properties: {
    operationId: operationChoiceSchema,
    difficultyId: difficultySchema,
    mapId: {
      ...mapIdSchema,
      description:
        'Only with operationId "custom": lays a fresh blank skirmish on this battlefield, ' +
        'replacing whatever is on the table. An authored operation is fought on its own ground.',
    },
  },
  required: ['operationId'],
  additionalProperties: false,
} as const;

export const LAUNCH_OPERATION_SCHEMA = {
  type: 'object',
  properties: { operationId: operationChoiceSchema, difficultyId: difficultySchema },
  additionalProperties: false,
} as const;

