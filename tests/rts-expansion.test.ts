import { describe, expect, it } from 'vitest';
import { GameQueries } from '../src/game/queries/GameQueries';
import { SimulationEngine } from '../src/game/simulation/Engine';

describe('RTS expansion commands', () => {
  it('applies formation-aware military orders atomically', () => {
    const engine = new SimulationEngine();
    const ids = ['unit_player_villager_01', 'unit_player_villager_02', 'unit_player_villager_03'];
    engine.dispatch('human', {
      type: 'issue_unit_order', playerId: 'player_kingdom', unitIds: ids,
      order: 'attack_move', destination: { x: 1000, y: 1200 }, formation: 'line', stance: 'aggressive',
    });
    expect(engine.step()[0]).toMatchObject({ ok: true });
    const snapshot = engine.getSnapshot();
    expect(ids.map((id) => snapshot.units[id]?.formation)).toEqual(['line', 'line', 'line']);
    expect(ids.map((id) => snapshot.units[id]?.order?.kind)).toEqual(['attack_move', 'attack_move', 'attack_move']);
    expect(new Set(ids.map((id) => snapshot.units[id]?.order?.targetPosition.x)).size).toBe(3);
  });

  it('supports rally points and cancellable production with a partial refund', () => {
    const engine = new SimulationEngine();
    const hall = 'building_player_town_hall';
    engine.dispatch('human', { type: 'set_rally_point', playerId: 'player_kingdom', buildingId: hall, position: { x: 940, y: 1480 } });
    engine.dispatch('human', { type: 'train_unit', playerId: 'player_kingdom', buildingId: hall, unitType: 'villager' });
    engine.step();
    const queued = engine.getSnapshot().buildings[hall]?.productionQueue[0];
    expect(queued).toBeDefined();
    engine.dispatch('human', { type: 'cancel_production', playerId: 'player_kingdom', buildingId: hall, orderId: queued?.id ?? '' });
    expect(engine.step()[0]).toMatchObject({ ok: true, data: { queueLength: 0 } });
    expect(engine.getSnapshot().players.player_kingdom?.resources.food).toBe(155);

    engine.dispatch('human', { type: 'train_unit', playerId: 'player_kingdom', buildingId: hall, unitType: 'villager' });
    engine.step();
    for (let tick = 0; tick < 180; tick += 1) engine.step();
    const spawned = Object.values(engine.getSnapshot().units).find((unit) => unit.ownerId === 'player_kingdom' && unit.id.includes('000'));
    expect(spawned?.order?.kind).toBe('move');
    expect(spawned?.order?.targetPosition).toEqual({ x: 940, y: 1480 });
  });

  it('reports placement validity through a purpose-built query', () => {
    const engine = new SimulationEngine();
    const queries = new GameQueries(() => engine.getSnapshot());
    expect(queries.checkBuildingPlacement('player_kingdom', 'house', { x: 610, y: 1570 })).toMatchObject({ valid: false, code: 'PLACEMENT_BLOCKED' });
    expect(queries.checkBuildingPlacement('player_kingdom', 'house', { x: 850, y: 1400 })).toMatchObject({ valid: true });
  });

  it('develops an economy-backed enemy settlement with mixed production', () => {
    const engine = new SimulationEngine();
    for (let tick = 0; tick < 7000; tick += 1) engine.step();
    const snapshot = engine.getSnapshot();
    const buildings = Object.values(snapshot.buildings).filter((building) => building.ownerId === 'enemy_kingdom' && building.status === 'complete').map((building) => building.type);
    expect(buildings).toEqual(expect.arrayContaining(['barracks', 'archery_range', 'stable', 'armoury', 'siege_workshop', 'watch_tower']));
    const units = Object.values(snapshot.units).filter((unit) => unit.ownerId === 'enemy_kingdom').map((unit) => unit.type);
    expect(new Set(units).size).toBeGreaterThanOrEqual(5);
  });
});
