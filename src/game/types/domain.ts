export const RESOURCE_TYPES = ['food', 'wood', 'stone', 'iron'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];
export type ResourceStockpile = Record<ResourceType, number>;

export const BUILDING_TYPES = [
  'town_hall', 'house', 'storehouse', 'barracks', 'archery_range', 'stable',
  'armoury', 'siege_workshop', 'watch_tower', 'wall', 'gate',
] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export const UNIT_TYPES = [
  'villager', 'swordsman', 'spearman', 'archer', 'knight', 'scout', 'catapult', 'battering_ram',
] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export const FORMATION_TYPES = ['line', 'column', 'square', 'wedge', 'loose'] as const;
export type FormationType = (typeof FORMATION_TYPES)[number];
export const COMBAT_STANCES = ['aggressive', 'defensive', 'hold_ground'] as const;
export type CombatStance = (typeof COMBAT_STANCES)[number];
export const MILITARY_ORDERS = ['attack_move', 'stop', 'hold_position', 'defend_area', 'retreat', 'set_formation', 'set_stance'] as const;
export type MilitaryOrderType = (typeof MILITARY_ORDERS)[number];

export const UPGRADE_TYPES = [
  'infantry_weapons_1', 'infantry_armor_1', 'archer_damage_1', 'cavalry_armor_1',
] as const;
export type UpgradeType = (typeof UPGRADE_TYPES)[number];

export type WorkerJob = 'idle' | 'moving' | 'gathering' | 'building' | 'repairing';
export interface Vector2D { x: number; y: number }

export interface UnitOrder {
  kind: 'move' | 'gather' | 'build' | 'repair' | 'attack' | 'attack_move' | 'hold' | 'defend' | 'retreat';
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
  formation: FormationType;
  stance: CombatStance;
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
  rallyPoint?: Vector2D;
}

export const STRATEGIC_SITE_TYPES = ['abandoned_watch_tower', 'capture_point', 'ruined_fort'] as const;
export type StrategicSiteType = (typeof STRATEGIC_SITE_TYPES)[number];
export interface StrategicSiteState {
  id: string;
  type: StrategicSiteType;
  position: Vector2D;
  label: string;
  purpose: string;
  controllingPlayerId?: string;
  capturePlayerId?: string;
  captureProgress: number;
  captureRequired: number;
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
