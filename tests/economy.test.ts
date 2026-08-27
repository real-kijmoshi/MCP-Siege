import { describe, expect, it } from 'vitest';
import { GameQueries } from '../src/game/queries/GameQueries';
import { SimulationEngine } from '../src/game/simulation/Engine';

describe('world economy, construction, and production', () => {
  it('gathers only after villagers physically reach a raw deposit', () => {
    const engine = new SimulationEngine();
    const workers = Object.values(engine.getSnapshot().villagers).filter((worker) => worker.ownerId === 'player_kingdom').map((worker) => worker.id);
    engine.dispatch('human', { type: 'gather_resource', playerId: 'player_kingdom', villagerIds: workers, resourceNodeId: 'resource_player_food' });
    engine.step();
    const initialFood = engine.getSnapshot().players.player_kingdom?.resources.food ?? 0;
    for (let tick = 0; tick < 40; tick += 1) engine.step();
    expect(engine.getSnapshot().players.player_kingdom?.resources.food).toBe(initialFood);
    for (let tick = 0; tick < 150; tick += 1) engine.step();
    expect(engine.getSnapshot().players.player_kingdom?.resources.food).toBeGreaterThan(initialFood);
    expect(Object.values(engine.getSnapshot().villagers).filter((worker) => worker.ownerId === 'player_kingdom').every((worker) => worker.job === 'gathering')).toBe(true);
  });

  it('constructs a House over time and increases the real population cap', () => {
    const engine = new SimulationEngine();
    const workerIds = ['unit_player_villager_01', 'unit_player_villager_02'];
    const beforeWood = engine.getSnapshot().players.player_kingdom?.resources.wood ?? 0;
    engine.dispatch('human', { type: 'place_building', playerId: 'player_kingdom', workerIds, buildingType: 'house', position: { x: 850, y: 1400 } });
    const [placed] = engine.step();
    expect(placed).toMatchObject({ ok: true, data: { buildingId: expect.any(String) } });
    expect(engine.getSnapshot().players.player_kingdom?.resources.wood).toBe(beforeWood - 60);
    const id = placed?.ok ? placed.data.buildingId : undefined;
    expect(id === undefined ? undefined : engine.getSnapshot().buildings[id]?.status).toBe('blueprint');
    expect(engine.getSnapshot().players.player_kingdom?.populationCap).toBe(10);
    for (let tick = 0; tick < 330; tick += 1) engine.step();
    expect(id === undefined ? undefined : engine.getSnapshot().buildings[id]?.status).toBe('complete');
    expect(engine.getSnapshot().players.player_kingdom?.populationCap).toBe(15);
  });

  it('blocks reserved production at the population cap and supports queues', () => {
    const engine = new SimulationEngine();
    const hall = 'building_player_town_hall';
    const workers = Object.values(engine.getSnapshot().villagers).filter((worker) => worker.ownerId === 'player_kingdom').map((worker) => worker.id);
    engine.dispatch('human', { type: 'gather_resource', playerId: 'player_kingdom', villagerIds: workers, resourceNodeId: 'resource_player_food' });
    engine.step();
    for (let tick = 0; tick < 300; tick += 1) engine.step();
    for (let index = 0; index < 5; index += 1) engine.dispatch('human', { type: 'train_unit', playerId: 'player_kingdom', buildingId: hall, unitType: 'villager' });
    const results = engine.step().filter((result) => result.commandId !== undefined).slice(-5);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(engine.getSnapshot().buildings[hall]?.productionQueue).toHaveLength(5);
    engine.dispatch('human', { type: 'train_unit', playerId: 'player_kingdom', buildingId: hall, unitType: 'villager' });
    expect(engine.step().find((result) => !result.ok)).toMatchObject({ ok: false, code: 'POPULATION_CAP' });
  });

  it('returns purpose-built economy projections with construction and queue state', () => {
    const engine = new SimulationEngine();
    const queries = new GameQueries(() => engine.getSnapshot());
    engine.dispatch('human', { type: 'assign_workers', playerId: 'player_kingdom', assignments: { food: 2, wood: 2, stone: 0, iron: 1 } });
    engine.step();
    const economy = queries.getEconomy('player_kingdom');
    expect(economy.workersByJob).toEqual({ food: 2, wood: 2, stone: 0, iron: 1 });
    expect(economy).not.toHaveProperty('villagers');
    expect(economy.population).toBe(5);
    expect(economy.populationCap).toBe(10);
  });

  it('grows the enemy base through the same visible economy rules', () => {
    const engine = new SimulationEngine();
    for (let tick = 0; tick < 1350; tick += 1) engine.step();
    const snapshot = engine.getSnapshot();
    const enemyBuildings = Object.values(snapshot.buildings).filter((building) => building.ownerId === 'enemy_kingdom');
    expect(enemyBuildings.some((building) => building.type === 'house' && building.status === 'complete')).toBe(true);
    expect(enemyBuildings.some((building) => building.type === 'barracks' && building.status === 'complete')).toBe(true);
    expect(Object.values(snapshot.units).filter((unit) => unit.ownerId === 'enemy_kingdom' && unit.type !== 'villager').length).toBeGreaterThan(0);
  });
});
