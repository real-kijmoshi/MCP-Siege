import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/game/simulation/Engine';
import { activeGroups } from '../src/game/simulation/GameState';
import { ZONES, useBattleMap, isPassable } from '../src/game/simulation/Zones';

describe('deadlock probe', () => {
  it('marches a regiment from the drowned wood to the beacon tower', () => {
    const engine = new SimulationEngine({ scenarioId: 'the_long_causeway', difficultyId: 'captain', seed: 7 });
    const state = engine.getState();
    useBattleMap(state.mapId);
    // Strip the battle down to one marching regiment so this measures navigation.
    for (const g of state.groups) {
      if (g.id === activeGroups(state, 'player')[0]!.id) continue;
      for (const m of g.members) state.units.kill(m);
      g.members.length = 0;
    }
    const group = activeGroups(state, 'player')[0]!;
    const source = ZONES.drowned_wood;
    group.anchor.x = source.center.x;
    group.anchor.y = source.center.y;
    engine.dispatch('human', {
      type: 'order_groups', playerId: 'player', groupIds: [group.id],
      order: 'move', targetZone: 'beacon_tower',
    });
    const goal = ZONES.beacon_tower.center;
    for (let tick = 0; tick < 1400; tick += 1) {
      engine.step();
    }
    const d = Math.hypot(group.anchor.x - goal.x, group.anchor.y - goal.y);
    expect(d).toBeLessThan(ZONES.beacon_tower.radius);
    expect(isPassable(group.anchor.x, group.anchor.y)).toBe(true);
  });
});
