import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/game/simulation/Engine';
import { findGroup } from '../src/game/simulation/GameState';
import { ZONES, useBattleMap, isPassable } from '../src/game/simulation/Zones';

describe('deadlock probe', () => {
  it('marches a regiment from the drowned wood to the beacon tower', () => {
    const engine = new SimulationEngine({ scenarioId: 'salt_tide', difficultyId: 'captain', seed: 7 });
    const state = engine.getState();
    useBattleMap(state.mapId);
    const group = findGroup(state, 'vanguard')!;
    // Strip the battle down to one marching regiment so this measures navigation.
    for (const g of state.groups) {
      if (g.id === group.id) continue;
      for (const m of g.members) state.units.kill(m);
      g.members.length = 0;
    }
    // An army of one regiment is a collapsed army, and a decided battle stops
    // every system including movement. Zeroing the strengths the collapse is
    // measured against keeps the field open for as long as the march needs.
    state.objective.initialStrength.player = 0;
    state.objective.initialStrength.enemy = 0;
    const source = ZONES.drowned_wood;
    group.anchor.x = source.center.x;
    group.anchor.y = source.center.y;
    engine.dispatch('human', {
      type: 'order_groups', playerId: 'player', groupIds: [group.id],
      order: 'move', targetZone: 'beacon_tower',
    });
    const goal = ZONES.beacon_tower.center;
    for (let tick = 0; tick < 2200; tick += 1) {
      engine.step();
    }
    const d = Math.hypot(group.anchor.x - goal.x, group.anchor.y - goal.y);
    expect(d).toBeLessThan(ZONES.beacon_tower.radius);
    expect(isPassable(group.anchor.x, group.anchor.y)).toBe(true);
  });
});

