import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/game/simulation/Engine';

describe('physical unit movement', () => {
  it('walks in deterministic formation instead of teleporting', () => {
    const engine = new SimulationEngine();
    const ids = ['unit_player_villager_03', 'unit_player_villager_01', 'unit_player_villager_02'];
    const start = engine.getSnapshot().units[ids[0] ?? '']?.position;
    engine.dispatch('human', { type: 'move_units', playerId: 'player_kingdom', unitIds: ids, destination: { x: 850, y: 700 } });
    engine.step();
    const afterOne = engine.getSnapshot().units[ids[0] ?? '']?.position;
    expect(afterOne).not.toEqual(start);
    expect(afterOne).not.toEqual({ x: 850, y: 700 });
    for (let tick = 0; tick < 220; tick += 1) engine.step();
    expect(engine.getSnapshot().units.unit_player_villager_01?.order).toBeUndefined();
    expect(engine.getSnapshot().villagers.unit_player_villager_01?.job).toBe('idle');
  });

  it('rejects the whole order when any unit is invalid', () => {
    const engine = new SimulationEngine();
    const before = engine.getSnapshot().villagers.unit_player_villager_01?.position;
    engine.dispatch('human', { type: 'move_units', playerId: 'player_kingdom', unitIds: ['unit_player_villager_01', 'missing'], destination: { x: 700, y: 420 } });
    expect(engine.step()[0]).toMatchObject({ ok: false, code: 'UNIT_NOT_OWNED' });
    expect(engine.getSnapshot().villagers.unit_player_villager_01?.position).toEqual(before);
  });
});
