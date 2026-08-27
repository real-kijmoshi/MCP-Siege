import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/game/simulation/Engine';

describe('command execution and starting state', () => {
  it('starts both sides with only a Town Hall and five villagers', () => {
    const snapshot = new SimulationEngine().getSnapshot();
    expect(Object.values(snapshot.villagers).filter((unit) => unit.ownerId === 'player_kingdom')).toHaveLength(5);
    expect(Object.values(snapshot.villagers).filter((unit) => unit.ownerId === 'enemy_kingdom')).toHaveLength(5);
    expect(Object.values(snapshot.buildings).map((building) => building.type)).toEqual(['town_hall', 'town_hall']);
    expect(snapshot.players.player_kingdom).toMatchObject({ population: 5, populationCap: 10 });
    expect(Object.values(snapshot.villagers).every((worker) => worker.job === 'idle')).toBe(true);
  });

  it('routes worker allocation to world resource orders without teleporting', () => {
    const engine = new SimulationEngine();
    const before = engine.getSnapshot().villagers.unit_player_villager_01?.position;
    const command = engine.dispatch('human', {
      type: 'assign_workers', playerId: 'player_kingdom',
      assignments: { food: 2, wood: 2, stone: 0, iron: 1 },
    });
    const [result] = engine.step();
    expect(result).toMatchObject({ ok: true, commandId: command.id, data: { assignments: { food: 2, wood: 2, stone: 0, iron: 1 } } });
    const worker = engine.getSnapshot().villagers.unit_player_villager_01;
    expect(worker?.order).toMatchObject({ kind: 'gather', targetId: 'resource_player_food' });
    expect(worker?.position).not.toEqual(before);
    expect(worker?.position).not.toEqual({ x: 350, y: 590 });
  });

  it('rejects invalid allocations atomically', () => {
    const engine = new SimulationEngine();
    const before = Object.values(engine.getSnapshot().villagers).filter((worker) => worker.ownerId === 'player_kingdom');
    engine.dispatch('human', { type: 'assign_workers', playerId: 'player_kingdom', assignments: { food: -1, wood: 2, stone: 2, iron: 2 } });
    expect(engine.step()[0]).toMatchObject({ ok: false, code: 'INVALID_WORKER_COUNT' });
    expect(Object.values(engine.getSnapshot().villagers).filter((worker) => worker.ownerId === 'player_kingdom')).toEqual(before);
  });

  it('uses stable sequence ordering for same-tick orders', () => {
    const engine = new SimulationEngine();
    const first = engine.dispatch('human', { type: 'assign_workers', playerId: 'player_kingdom', assignments: { food: 5, wood: 0, stone: 0, iron: 0 } });
    const second = engine.dispatch('webmcp', { type: 'assign_workers', playerId: 'player_kingdom', assignments: { food: 0, wood: 0, stone: 0, iron: 5 } });
    expect(engine.step().filter((result) => [first.id, second.id].includes(result.commandId)).map((result) => result.commandId)).toEqual([first.id, second.id]);
    expect(Object.values(engine.getSnapshot().villagers)
      .filter((worker) => worker.ownerId === 'player_kingdom')
      .every((worker) => worker.order?.targetId === 'resource_player_iron')).toBe(true);
  });

  it('does not expose authoritative state through snapshots', () => {
    const engine = new SimulationEngine();
    const leaked = engine.getSnapshot();
    const player = leaked.players.player_kingdom;
    if (player === undefined) throw new Error('Fixture player missing');
    player.resources.food = 99999;
    delete leaked.villagers.unit_player_villager_01;
    expect(engine.getSnapshot().players.player_kingdom?.resources.food).toBe(180);
    expect(engine.getSnapshot().villagers.unit_player_villager_01).toBeDefined();
  });
});
