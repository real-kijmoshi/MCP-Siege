import type { CommandLogEntry } from '../commands/types';
import type { BuildingState, PlayerState, ResourceNodeState, UnitState, VillagerState } from '../types/domain';
import type { RandomState } from './Random';

export interface GameState {
  gameSeed: number;
  random: RandomState;
  currentTick: number;
  commandSequence: number;
  entitySequence: number;
  players: Record<string, PlayerState>;
  villagers: Record<string, VillagerState>;
  units: Record<string, UnitState>;
  buildings: Record<string, BuildingState>;
  resourceNodes: Record<string, ResourceNodeState>;
  commandLog: CommandLogEntry[];
}
export type GameSnapshot = GameState;

function createVillagers(ownerId: string, prefix: string, x: number, y: number): Record<string, VillagerState> {
  const villagers: Record<string, VillagerState> = {};
  for (let index = 1; index <= 5; index += 1) {
    const id = `unit_${prefix}_villager_${String(index).padStart(2, '0')}`;
    villagers[id] = {
      id, ownerId, type: 'villager', job: 'idle',
      position: { x: x + ((index - 1) % 3) * 24, y: y + Math.floor((index - 1) / 3) * 26 },
      hitPoints: 40, maxHitPoints: 40, attackCooldown: 0,
    };
  }
  return villagers;
}

function node(id: string, type: ResourceNodeState['type'], x: number, y: number, capacity: number): ResourceNodeState {
  return { id, type, position: { x, y }, remaining: capacity, capacity };
}

export function createInitialGameState(seed = 13_371): GameState {
  const playerVillagers = createVillagers('player_kingdom', 'player', 610, 520);
  const enemyVillagers = createVillagers('enemy_kingdom', 'enemy', 1160, 295);
  const villagers = { ...playerVillagers, ...enemyVillagers };
  return {
    gameSeed: seed, random: { value: seed >>> 0 || 1 }, currentTick: 0,
    commandSequence: 1, entitySequence: 1,
    players: {
      player_kingdom: {
        id: 'player_kingdom', name: 'Crownlands',
        resources: { food: 180, wood: 220, stone: 90, iron: 60 },
        population: 5, populationCap: 10, completedUpgrades: [],
      },
      enemy_kingdom: {
        id: 'enemy_kingdom', name: 'Ashen Host',
        resources: { food: 180, wood: 220, stone: 90, iron: 60 },
        population: 5, populationCap: 10, completedUpgrades: [],
      },
    },
    villagers,
    units: { ...villagers },
    buildings: {
      building_player_town_hall: {
        id: 'building_player_town_hall', ownerId: 'player_kingdom', type: 'town_hall',
        position: { x: 535, y: 455 }, status: 'complete', constructionProgress: 1,
        constructionRequired: 1, hitPoints: 1200, maxHitPoints: 1200, productionQueue: [],
      },
      building_enemy_town_hall: {
        id: 'building_enemy_town_hall', ownerId: 'enemy_kingdom', type: 'town_hall',
        position: { x: 1235, y: 235 }, status: 'complete', constructionProgress: 1,
        constructionRequired: 1, hitPoints: 1200, maxHitPoints: 1200, productionQueue: [],
      },
    },
    resourceNodes: {
      resource_player_food: node('resource_player_food', 'food', 350, 590, 3000),
      resource_player_forest: node('resource_player_forest', 'wood', 720, 350, 6000),
      resource_player_stone: node('resource_player_stone', 'stone', 335, 350, 3500),
      resource_player_iron: node('resource_player_iron', 'iron', 760, 610, 3000),
      resource_enemy_food: node('resource_enemy_food', 'food', 1060, 170, 3000),
      resource_enemy_forest: node('resource_enemy_forest', 'wood', 1370, 360, 6000),
      resource_enemy_stone: node('resource_enemy_stone', 'stone', 1050, 390, 3500),
      resource_enemy_iron: node('resource_enemy_iron', 'iron', 1390, 150, 3000),
    },
    commandLog: [],
  };
}

export function cloneGameState(state: GameState): GameSnapshot { return structuredClone(state); }
