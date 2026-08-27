import type { CommandLogEntry } from '../commands/types';
import type { BuildingState, PlayerState, ResourceNodeState, StrategicSiteState, UnitState, VillagerState } from '../types/domain';
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
  strategicSites: Record<string, StrategicSiteState>;
  visibility: Record<string, PlayerVisibilityState>;
  commandLog: CommandLogEntry[];
}
export type GameSnapshot = GameState;

export interface PlayerVisibilityState {
  explored: boolean[];
  visible: boolean[];
}

function createVillagers(ownerId: string, prefix: string, x: number, y: number): Record<string, VillagerState> {
  const villagers: Record<string, VillagerState> = {};
  for (let index = 1; index <= 5; index += 1) {
    const id = `unit_${prefix}_villager_${String(index).padStart(2, '0')}`;
    villagers[id] = {
      id, ownerId, type: 'villager', job: 'idle',
      position: { x: x + ((index - 1) % 3) * 24, y: y + Math.floor((index - 1) / 3) * 26 },
      hitPoints: 40, maxHitPoints: 40, attackCooldown: 0, formation: 'loose', stance: 'defensive',
    };
  }
  return villagers;
}

function node(id: string, type: ResourceNodeState['type'], x: number, y: number, capacity: number): ResourceNodeState {
  return { id, type, position: { x, y }, remaining: capacity, capacity };
}

function addCluster(
  target: Record<string, ResourceNodeState>, baseId: string, type: ResourceNodeState['type'],
  points: Array<readonly [number, number]>, capacity: number,
): void {
  points.forEach(([x, y], index) => {
    const id = index === 0 ? baseId : `${baseId}_${String(index + 1).padStart(2, '0')}`;
    target[id] = node(id, type, x, y, capacity);
  });
}

function forestPatch(originX: number, originY: number, columns: number, rows: number): Array<readonly [number, number]> {
  const points: Array<readonly [number, number]> = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      points.push([
        originX + column * 58 + (row % 2) * 24 + ((column * 17 + row * 11) % 19),
        originY + row * 57 + ((column * 13 + row * 7) % 17),
      ]);
    }
  }
  return points;
}

function createResourceNodes(): Record<string, ResourceNodeState> {
  const nodes: Record<string, ResourceNodeState> = {};

  // Southwest opening: berries and timber are close; stone and iron pull expansion toward the ridge.
  addCluster(nodes, 'resource_player_food', 'food', [
    [920, 1570], [965, 1535], [1005, 1590], [950, 1630], [1040, 1555], [1000, 1660],
  ], 460);
  addCluster(nodes, 'resource_player_forest', 'wood', [
    ...forestPatch(90, 1030, 6, 10), ...forestPatch(390, 1130, 3, 7),
  ], 360);
  addCluster(nodes, 'resource_player_stone', 'stone', [
    [1110, 1110], [1165, 1080], [1215, 1135], [1080, 1170], [1160, 1190], [1240, 1070],
  ], 680);
  addCluster(nodes, 'resource_player_iron', 'iron', [
    [1320, 1740], [1380, 1705], [1440, 1755], [1360, 1800], [1480, 1685],
  ], 620);

  // Northeast territory mirrors the resource journey without revealing it to the player.
  addCluster(nodes, 'resource_enemy_food', 'food', [
    [2440, 430], [2490, 390], [2535, 445], [2460, 485], [2570, 390], [2540, 505],
  ], 460);
  addCluster(nodes, 'resource_enemy_forest', 'wood', [
    ...forestPatch(2920, 210, 4, 9), ...forestPatch(2380, 30, 4, 3),
  ], 360);
  addCluster(nodes, 'resource_enemy_stone', 'stone', [
    [2130, 690], [2190, 650], [2245, 705], [2160, 755], [2270, 645], [2220, 790],
  ], 680);
  addCluster(nodes, 'resource_enemy_iron', 'iron', [
    [2770, 770], [2830, 730], [2890, 780], [2810, 825], [2930, 720],
  ], 620);

  // A central wood line shapes the open army field without prebuilding any settlement.
  addCluster(nodes, 'resource_central_forest', 'wood', forestPatch(2330, 1120, 6, 5), 340);
  return nodes;
}

export function createInitialGameState(seed = 13_371): GameState {
  const playerVillagers = createVillagers('player_kingdom', 'player', 690, 1510);
  const enemyVillagers = createVillagers('enemy_kingdom', 'enemy', 2570, 330);
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
        position: { x: 610, y: 1570 }, status: 'complete', constructionProgress: 1,
        constructionRequired: 1, hitPoints: 1200, maxHitPoints: 1200, productionQueue: [],
      },
      building_enemy_town_hall: {
        id: 'building_enemy_town_hall', ownerId: 'enemy_kingdom', type: 'town_hall',
        position: { x: 2660, y: 300 }, status: 'complete', constructionProgress: 1,
        constructionRequired: 1, hitPoints: 1200, maxHitPoints: 1200, productionQueue: [],
      },
    },
    resourceNodes: createResourceNodes(),
    strategicSites: {
      landmark_western_watch: {
        id: 'landmark_western_watch', type: 'abandoned_watch_tower', position: { x: 1390, y: 820 },
        label: 'Abandoned Watch Tower', purpose: 'Capture for extended vision over the western crossing.',
        captureProgress: 0, captureRequired: 240,
      },
      landmark_bridge_crossing: {
        id: 'landmark_bridge_crossing', type: 'capture_point', position: { x: 1690, y: 1020 },
        label: 'Bridge Crossing', purpose: 'Control the central bridge to gain a steady food and wood trickle.',
        captureProgress: 0, captureRequired: 200,
      },
      landmark_ruined_fort: {
        id: 'landmark_ruined_fort', type: 'ruined_fort', position: { x: 2070, y: 1280 },
        label: 'Ruined Fort', purpose: 'Capture this defensible landmark for stone and iron income.',
        captureProgress: 0, captureRequired: 280,
      },
    },
    visibility: {
      player_kingdom: { explored: [], visible: [] },
      enemy_kingdom: { explored: [], visible: [] },
    },
    commandLog: [],
  };
}

export function cloneGameState(state: GameState): GameSnapshot { return structuredClone(state); }
