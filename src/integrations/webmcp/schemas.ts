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
