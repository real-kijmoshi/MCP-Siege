import type { BuildingType, ResourceStockpile, UnitType, UpgradeType } from '../types/domain';

export const TICKS_PER_SECOND = 20;
export const WORLD_WIDTH = 3200;
export const WORLD_HEIGHT = 2000;
export const FOG_CELL_SIZE = 50;
export const FOG_COLUMNS = WORLD_WIDTH / FOG_CELL_SIZE;
export const FOG_ROWS = WORLD_HEIGHT / FOG_CELL_SIZE;
export const UNIT_VISION_RADIUS = 400;
export const BUILDING_VISION_RADIUS = 500;

export interface BuildingDefinition {
  label: string;
  cost: Partial<ResourceStockpile>;
  buildTicks: number;
  hitPoints: number;
  populationCap: number;
  footprint: number;
  purpose: string;
}

export const BUILDINGS: Record<BuildingType, BuildingDefinition> = {
  town_hall: { label: 'Town Hall', cost: {}, buildTicks: 1, hitPoints: 1200, populationCap: 10, footprint: 72, purpose: 'Trains villagers' },
  house: { label: 'House', cost: { wood: 60 }, buildTicks: 180, hitPoints: 420, populationCap: 5, footprint: 38, purpose: '+5 population capacity' },
  storehouse: { label: 'Storehouse', cost: { wood: 80, stone: 20 }, buildTicks: 220, hitPoints: 550, populationCap: 0, footprint: 42, purpose: 'Improves nearby gathering' },
  barracks: { label: 'Barracks', cost: { wood: 120, stone: 30 }, buildTicks: 300, hitPoints: 750, populationCap: 0, footprint: 54, purpose: 'Trains swordsmen and spearmen' },
  archery_range: { label: 'Archery Range', cost: { wood: 140 }, buildTicks: 300, hitPoints: 650, populationCap: 0, footprint: 52, purpose: 'Trains archers' },
  stable: { label: 'Stable', cost: { wood: 160, stone: 40 }, buildTicks: 360, hitPoints: 780, populationCap: 0, footprint: 58, purpose: 'Trains scouts and knights' },
  armoury: { label: 'Armoury', cost: { wood: 100, iron: 60 }, buildTicks: 320, hitPoints: 700, populationCap: 0, footprint: 48, purpose: 'Researches military upgrades' },
  siege_workshop: { label: 'Siege Workshop', cost: { wood: 180, stone: 80, iron: 50 }, buildTicks: 420, hitPoints: 850, populationCap: 0, footprint: 62, purpose: 'Builds siege engines' },
  watch_tower: { label: 'Watch Tower', cost: { wood: 80, stone: 50 }, buildTicks: 260, hitPoints: 650, populationCap: 0, footprint: 30, purpose: 'Automatically attacks nearby enemies' },
  wall: { label: 'Wall', cost: { stone: 20 }, buildTicks: 100, hitPoints: 500, populationCap: 0, footprint: 22, purpose: 'Blocks and absorbs attacks' },
  gate: { label: 'Gate', cost: { wood: 40, stone: 40 }, buildTicks: 180, hitPoints: 700, populationCap: 0, footprint: 34, purpose: 'Defensive settlement entrance' },
};

export interface UnitDefinition {
  label: string;
  cost: Partial<ResourceStockpile>;
  trainTicks: number;
  hitPoints: number;
  damage: number;
  range: number;
  speed: number;
  population: number;
}

export const UNITS: Record<UnitType, UnitDefinition> = {
  villager: { label: 'Villager', cost: { food: 50 }, trainTicks: 180, hitPoints: 40, damage: 2, range: 18, speed: 2.1, population: 1 },
  swordsman: { label: 'Swordsman', cost: { food: 55, iron: 20 }, trainTicks: 220, hitPoints: 90, damage: 11, range: 22, speed: 2.25, population: 1 },
  spearman: { label: 'Spearman', cost: { food: 45, wood: 20 }, trainTicks: 200, hitPoints: 75, damage: 9, range: 30, speed: 2.3, population: 1 },
  archer: { label: 'Archer', cost: { food: 45, wood: 35 }, trainTicks: 220, hitPoints: 55, damage: 8, range: 125, speed: 2.35, population: 1 },
  knight: { label: 'Knight', cost: { food: 90, iron: 70 }, trainTicks: 360, hitPoints: 180, damage: 18, range: 25, speed: 3.1, population: 2 },
  scout: { label: 'Scout', cost: { food: 65, wood: 20 }, trainTicks: 220, hitPoints: 80, damage: 6, range: 24, speed: 3.8, population: 1 },
  catapult: { label: 'Catapult', cost: { wood: 120, stone: 80 }, trainTicks: 440, hitPoints: 150, damage: 34, range: 170, speed: 1.15, population: 3 },
  battering_ram: { label: 'Battering Ram', cost: { wood: 140, iron: 40 }, trainTicks: 400, hitPoints: 240, damage: 45, range: 25, speed: 1.25, population: 3 },
};

export const PRODUCTION: Partial<Record<BuildingType, UnitType[]>> = {
  town_hall: ['villager'], barracks: ['swordsman', 'spearman'],
  archery_range: ['archer'], stable: ['scout', 'knight'],
  siege_workshop: ['catapult', 'battering_ram'],
};

export const UPGRADES: Record<UpgradeType, { label: string; cost: Partial<ResourceStockpile> }> = {
  infantry_weapons_1: { label: 'Infantry Weapons I', cost: { food: 80, iron: 60 } },
  infantry_armor_1: { label: 'Infantry Armor I', cost: { food: 70, iron: 70 } },
  archer_damage_1: { label: 'Archer Damage I', cost: { food: 80, wood: 80 } },
  cavalry_armor_1: { label: 'Cavalry Armor I', cost: { food: 100, iron: 90 } },
};

export const GATHER_PER_TICK: Record<keyof ResourceStockpile, number> = {
  food: 0.16, wood: 0.14, stone: 0.1, iron: 0.09,
};

export function hasResources(stockpile: ResourceStockpile, cost: Partial<ResourceStockpile>): boolean {
  return Object.entries(cost).every(([resource, amount]) =>
    stockpile[resource as keyof ResourceStockpile] >= (amount ?? 0));
}

export function spendResources(stockpile: ResourceStockpile, cost: Partial<ResourceStockpile>): void {
  for (const [resource, amount] of Object.entries(cost)) {
    stockpile[resource as keyof ResourceStockpile] -= amount ?? 0;
  }
}
