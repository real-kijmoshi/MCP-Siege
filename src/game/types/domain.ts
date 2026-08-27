export const RESOURCE_TYPES = ['food', 'wood', 'stone', 'iron'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];
export type ResourceStockpile = Record<ResourceType, number>;

export const BUILDING_TYPES = [
  'town_hall', 'house', 'storehouse', 'barracks', 'archery_range', 'stable',
  'armoury', 'siege_workshop', 'watch_tower', 'wall', 'gate',
] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export const UNIT_TYPES = [
  'villager', 'swordsman', 'spearman', 'archer', 'knight', 'catapult', 'battering_ram',
] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export const UPGRADE_TYPES = [
  'infantry_weapons_1', 'infantry_armor_1', 'archer_damage_1', 'cavalry_armor_1',
] as const;
export type UpgradeType = (typeof UPGRADE_TYPES)[number];

export type WorkerJob = 'idle' | 'moving' | 'gathering' | 'building';
export interface Vector2D { x: number; y: number }

export interface UnitOrder {
  kind: 'move' | 'gather' | 'build' | 'attack';
  targetPosition: Vector2D;
  targetId?: string;
}

export interface UnitState {
  id: string;
  ownerId: string;
  type: UnitType;
  position: Vector2D;
  hitPoints: number;
  maxHitPoints: number;
  order?: UnitOrder;
  attackCooldown: number;
}

export interface VillagerState extends UnitState {
  type: 'villager';
  job: WorkerJob;
  carriedResource?: ResourceType;
}

export interface ProductionOrder {
  id: string;
  unitType: UnitType;
  remainingTicks: number;
  totalTicks: number;
}

export interface BuildingState {
  id: string;
  ownerId: string;
  type: BuildingType;
  position: Vector2D;
  status: 'blueprint' | 'complete';
  constructionProgress: number;
  constructionRequired: number;
  hitPoints: number;
  maxHitPoints: number;
  productionQueue: ProductionOrder[];
}

export interface ResourceNodeState {
  id: string;
  type: ResourceType;
  position: Vector2D;
  remaining: number;
  capacity: number;
}

export interface PlayerState {
  id: string;
  name: string;
  resources: ResourceStockpile;
  population: number;
  populationCap: number;
  completedUpgrades: UpgradeType[];
}

export type WorkerAssignments = Record<ResourceType, number>;
export function emptyWorkerAssignments(): WorkerAssignments {
  return { food: 0, wood: 0, stone: 0, iron: 0 };
}
