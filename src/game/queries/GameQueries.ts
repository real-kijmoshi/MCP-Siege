import {
  BUILDINGS, FOG_CELL_SIZE, FOG_COLUMNS, FOG_ROWS, GATHER_PER_TICK, TICKS_PER_SECOND, UNITS,
} from '../config/gameplay';
import type { GameSnapshot } from '../simulation/GameState';
import { checkBuildingPlacement, type PlacementCheck } from '../simulation/Placement';
import { visibilityAt } from '../simulation/Visibility';
import {
  RESOURCE_TYPES, emptyWorkerAssignments,
  type BuildingState, type BuildingType, type ResourceNodeState, type ResourceStockpile, type StrategicSiteState, type UnitState, type Vector2D,
} from '../types/domain';

export interface GameOverview {
  tick: number; resources: ResourceStockpile; population: number; populationCap: number;
  workerCount: number; militaryCount: number; activeRegimentCount: number;
  alerts: string[]; visibleThreatSummary: string; importantOngoingProduction: string[];
}
export interface EconomyOverview {
  tick: number; resources: ResourceStockpile; gatheringRatesPerSecond: ResourceStockpile;
  workersByJob: ReturnType<typeof emptyWorkerAssignments>; idleWorkerCount: number;
  totalWorkers: number; constructionJobs: string[]; productionQueues: string[];
  population: number; populationCap: number;
}
export interface FogProjection {
  cellSize: number;
  columns: number;
  rows: number;
  cells: Array<0 | 1 | 2>;
}
export interface WorldView {
  tick: number;
  units: UnitState[];
  buildings: BuildingState[];
  resourceNodes: ResourceNodeState[];
  strategicSites: StrategicSiteState[];
  fog: FogProjection;
}
export interface CommandEntityOverview {
  tick: number;
  friendlyUnits: Array<Pick<UnitState, 'id' | 'type' | 'position' | 'hitPoints' | 'maxHitPoints' | 'order'>>;
  friendlyBuildings: Array<Pick<BuildingState, 'id' | 'type' | 'position' | 'status' | 'hitPoints' | 'maxHitPoints' | 'productionQueue' | 'rallyPoint'>>;
  visibleEnemies: Array<{ id: string; kind: 'unit' | 'building'; type: string; position: Vector2D }>;
}
export class QueryError extends Error {
  public constructor(public readonly code: string, message: string) { super(message); this.name = 'QueryError'; }
}

function rounded(resources: ResourceStockpile): ResourceStockpile {
  return {
    food: Number(resources.food.toFixed(2)), wood: Number(resources.wood.toFixed(2)),
    stone: Number(resources.stone.toFixed(2)), iron: Number(resources.iron.toFixed(2)),
  };
}

export class GameQueries {
  public constructor(private readonly snapshotProvider: () => GameSnapshot) {}

  public getGameOverview(playerId: string): GameOverview {
    const snapshot = this.snapshotProvider();
    const player = snapshot.players[playerId];
    if (player === undefined) throw new QueryError('PLAYER_NOT_FOUND', 'Player perspective is unavailable.');
    const friendlyUnits = Object.values(snapshot.units).filter((unit) => unit.ownerId === playerId);
    const workers = friendlyUnits.filter((unit) => unit.type === 'villager');
    const military = friendlyUnits.filter((unit) => unit.type !== 'villager');
    const enemies = Object.values(snapshot.units).filter((unit) =>
      unit.ownerId !== playerId && visibilityAt(snapshot, playerId, unit.position) === 'visible');
    const alerts: string[] = [];
    const idle = workers.filter((worker) => snapshot.villagers[worker.id]?.job === 'idle').length;
    if (idle > 0) alerts.push(`${idle} worker${idle === 1 ? '' : 's'} idle.`);
    if (player.population >= player.populationCap) alerts.push(`Population cap reached (${player.population} / ${player.populationCap}). Build a House.`);
    const queues = Object.values(snapshot.buildings)
      .filter((building) => building.ownerId === playerId && building.productionQueue.length > 0)
      .map((building) => `${BUILDINGS[building.type].label}: ${building.productionQueue.map((item) => UNITS[item.unitType].label).join(', ')}`);
    return {
      tick: snapshot.currentTick, resources: rounded(player.resources),
      population: player.population, populationCap: player.populationCap,
      workerCount: workers.length, militaryCount: military.length, activeRegimentCount: 0,
      alerts,
      visibleThreatSummary: enemies.length === 0
        ? 'No enemy forces currently visible.'
        : `${enemies.length} enemy unit${enemies.length === 1 ? '' : 's'} currently visible.`,
      importantOngoingProduction: queues,
    };
  }

  public getWorldView(playerId: string): WorldView {
    const snapshot = this.snapshotProvider();
    if (snapshot.players[playerId] === undefined) throw new QueryError('PLAYER_NOT_FOUND', 'Player perspective is unavailable.');
    const visibility = snapshot.visibility[playerId];
    const cells = Array.from({ length: FOG_COLUMNS * FOG_ROWS }, (_, index): 0 | 1 | 2 =>
      visibility?.visible[index] ? 2 : visibility?.explored[index] ? 1 : 0);
    return {
      tick: snapshot.currentTick,
      units: Object.values(snapshot.units)
        .filter((unit) => unit.ownerId === playerId || visibilityAt(snapshot, playerId, unit.position) === 'visible')
        .map((unit) => structuredClone(unit)),
      buildings: Object.values(snapshot.buildings)
        .filter((building) => building.ownerId === playerId || visibilityAt(snapshot, playerId, building.position) !== 'unexplored')
        .map((building) => structuredClone(building)),
      resourceNodes: Object.values(snapshot.resourceNodes)
        .filter((node) => visibilityAt(snapshot, playerId, node.position) !== 'unexplored')
        .map((node) => structuredClone(node)),
      strategicSites: Object.values(snapshot.strategicSites)
        .filter((site) => visibilityAt(snapshot, playerId, site.position) !== 'unexplored')
        .map((site) => structuredClone(site)),
      fog: { cellSize: FOG_CELL_SIZE, columns: FOG_COLUMNS, rows: FOG_ROWS, cells },
    };
  }

  public checkBuildingPlacement(playerId: string, buildingType: BuildingType, position: Vector2D): PlacementCheck {
    const snapshot = this.snapshotProvider();
    if (snapshot.players[playerId] === undefined) throw new QueryError('PLAYER_NOT_FOUND', 'Player perspective is unavailable.');
    return checkBuildingPlacement(snapshot, buildingType, position);
  }

  public getEconomy(playerId: string): EconomyOverview {
    const snapshot = this.snapshotProvider();
    const player = snapshot.players[playerId];
    if (player === undefined) throw new QueryError('PLAYER_NOT_FOUND', 'Player perspective is unavailable.');
    const workersByJob = emptyWorkerAssignments();
    let idleWorkerCount = 0;
    const workers = Object.values(snapshot.villagers).filter((worker) => worker.ownerId === playerId);
    for (const worker of workers) {
      if (worker.job === 'idle') idleWorkerCount += 1;
      if (worker.order?.kind === 'gather' && worker.order.targetId !== undefined) {
        const node = snapshot.resourceNodes[worker.order.targetId];
        if (node !== undefined) workersByJob[node.type] += 1;
      }
    }
    const rates = RESOURCE_TYPES.reduce<ResourceStockpile>((result, resource) => {
      result[resource] = Number((workersByJob[resource] * GATHER_PER_TICK[resource] * TICKS_PER_SECOND).toFixed(2));
      return result;
    }, { food: 0, wood: 0, stone: 0, iron: 0 });
    return {
      tick: snapshot.currentTick, resources: rounded(player.resources), gatheringRatesPerSecond: rates,
      workersByJob, idleWorkerCount, totalWorkers: workers.length,
      constructionJobs: Object.values(snapshot.buildings)
        .filter((building) => building.ownerId === playerId && building.status === 'blueprint')
        .map((building) => `${BUILDINGS[building.type].label} ${Math.floor(100 * building.constructionProgress / building.constructionRequired)}%`),
      productionQueues: Object.values(snapshot.buildings)
        .filter((building) => building.ownerId === playerId && building.productionQueue.length > 0)
        .map((building) => `${BUILDINGS[building.type].label}: ${building.productionQueue.length} queued`),
      population: player.population, populationCap: player.populationCap,
    };
  }

  public getCommandEntities(playerId: string): CommandEntityOverview {
    const snapshot = this.snapshotProvider();
    if (snapshot.players[playerId] === undefined) throw new QueryError('PLAYER_NOT_FOUND', 'Player perspective is unavailable.');
    return {
      tick: snapshot.currentTick,
      friendlyUnits: Object.values(snapshot.units).filter((unit) => unit.ownerId === playerId).sort((a, b) => a.id.localeCompare(b.id)).map((unit) => ({
        id: unit.id, type: unit.type, position: { ...unit.position }, hitPoints: unit.hitPoints, maxHitPoints: unit.maxHitPoints,
        ...(unit.order === undefined ? {} : { order: structuredClone(unit.order) }),
      })),
      friendlyBuildings: Object.values(snapshot.buildings).filter((building) => building.ownerId === playerId).sort((a, b) => a.id.localeCompare(b.id)).map((building) => ({
        id: building.id, type: building.type, position: { ...building.position }, status: building.status,
        hitPoints: building.hitPoints, maxHitPoints: building.maxHitPoints, productionQueue: structuredClone(building.productionQueue),
        ...(building.rallyPoint === undefined ? {} : { rallyPoint: { ...building.rallyPoint } }),
      })),
      visibleEnemies: [
        ...Object.values(snapshot.units).filter((unit) => unit.ownerId !== playerId && visibilityAt(snapshot, playerId, unit.position) === 'visible')
          .map((unit) => ({ id: unit.id, kind: 'unit' as const, type: unit.type, position: { ...unit.position } })),
        ...Object.values(snapshot.buildings).filter((building) => building.ownerId !== playerId && visibilityAt(snapshot, playerId, building.position) === 'visible')
          .map((building) => ({ id: building.id, kind: 'building' as const, type: building.type, position: { ...building.position } })),
      ].sort((a, b) => a.id.localeCompare(b.id)),
    };
  }
}
