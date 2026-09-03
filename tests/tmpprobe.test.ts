import { describe, it } from 'vitest';
import { TICKS_PER_SECOND } from '../src/game/config/battle';
import { BATTLE_MAPS } from '../src/game/config/maps';
import { SCENARIOS } from '../src/game/config/scenario';
import { AUTHORED_SCENARIO_IDS } from '../src/game/config/matches';
import { SimulationEngine } from '../src/game/simulation/Engine';

describe('probe', () => {
  for (const scenarioId of AUTHORED_SCENARIO_IDS) {
    it(`${scenarioId}`, () => {
      const scenario = SCENARIOS[scenarioId];
      const map = BATTLE_MAPS[scenario.mapId];
      const engine = new SimulationEngine({ scenarioId, difficultyId: 'captain' });
      const state = engine.getState();
      const crossing = map.zones.find((z) => z.crossing)?.id ?? map.enemyHomeZone;

      let ticks = 0;
      for (let tick = 0; tick < TICKS_PER_SECOND * 60 * 20; tick += 1) {
        if (tick === 30 * TICKS_PER_SECOND) {
          engine.dispatch('human', {
            type: 'order_groups',
            playerId: 'player',
            groupIds: ['vanguard', 'ironbacks', 'hedge', 'longbows'],
            order: 'attack_zone',
            targetZone: crossing,
          });
        }
        if (tick === 240 * TICKS_PER_SECOND) {
          engine.dispatch('human', {
            type: 'order_groups',
            playerId: 'player',
            groupIds: ['vanguard', 'ironbacks', 'hedge', 'fenmen', 'greyriders', 'lancers'],
            order: 'attack_zone',
            targetZone: map.enemyHomeZone,
          });
        }
        engine.step();
        ticks = tick;
        if (state.objective.outcome !== 'ongoing') break;
      }

      const strength = (owner: string): number =>
        state.groups.filter((g) => g.ownerId === owner).reduce((s, g) => s + g.members.length, 0);

      // eslint-disable-next-line no-console
      console.log(
        `RESULT ${scenarioId} ${scenario.mapId} ${state.objective.outcome} ` +
          `${Math.round(ticks / TICKS_PER_SECOND)}s player=${strength('player')}/${state.objective.initialStrength.player} ` +
          `enemy=${strength('enemy')}/${state.objective.initialStrength.enemy}`,
      );
    });
  }
});

