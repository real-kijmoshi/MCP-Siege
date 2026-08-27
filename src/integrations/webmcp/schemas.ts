export const EMPTY_INPUT_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const;

const workerCountSchema = {
  type: 'integer',
  minimum: 0,
  maximum: 200,
} as const;

export const ASSIGN_WORKERS_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    food: { ...workerCountSchema, description: 'Desired workers gathering food.' },
    wood: { ...workerCountSchema, description: 'Desired workers gathering wood.' },
    stone: { ...workerCountSchema, description: 'Desired workers gathering stone.' },
    iron: { ...workerCountSchema, description: 'Desired workers gathering iron.' },
  },
  required: ['food', 'wood', 'stone', 'iron'],
  additionalProperties: false,
} as const;

const idListSchema = { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, maxItems: 200, uniqueItems: true } as const;
const coordinateSchema = { type: 'number', minimum: 0, maximum: 3200 } as const;

export const CONSTRUCT_BUILDING_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    buildingType: { type: 'string', enum: ['house', 'storehouse', 'barracks', 'archery_range', 'stable', 'armoury', 'siege_workshop', 'watch_tower', 'wall', 'gate'] },
    workerIds: idListSchema,
    x: coordinateSchema,
    y: { ...coordinateSchema, maximum: 2000 },
  },
  required: ['buildingType', 'workerIds', 'x', 'y'], additionalProperties: false,
} as const;

export const TRAIN_UNIT_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    buildingId: { type: 'string', minLength: 1 },
    unitType: { type: 'string', enum: ['villager', 'swordsman', 'spearman', 'archer', 'knight', 'scout', 'catapult', 'battering_ram'] },
  },
  required: ['buildingId', 'unitType'], additionalProperties: false,
} as const;

export const ORDER_UNITS_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    unitIds: idListSchema,
    order: { type: 'string', enum: ['move', 'attack', 'attack_move', 'stop', 'hold_position', 'defend_area', 'retreat'] },
    targetId: { type: 'string', minLength: 1 },
    x: coordinateSchema,
    y: { ...coordinateSchema, maximum: 2000 },
    formation: { type: 'string', enum: ['line', 'column', 'square', 'wedge', 'loose'] },
    stance: { type: 'string', enum: ['aggressive', 'defensive', 'hold_ground'] },
  },
  required: ['unitIds', 'order'], additionalProperties: false,
} as const;
