import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../src/game/config/battle';
import { BATTLE_MAPS } from '../src/game/config/maps';
import { SCENARIOS } from '../src/game/config/scenario';
import type { ScenarioId } from '../src/game/config/matches';
import { SimulationEngine } from '../src/game/simulation/Engine';
import { stateChecksum } from '../src/game/simulation/GameState';
import { activeZoneIds } from '../src/game/simulation/Zones';

/**
 * The four operations fought somewhere other than River Vale.
 *
 * A new map can be geometrically sound and still be unplayable: the enemy
 * script can name ground his army cannot reach, the two sides can deploy where
 * they never meet, and a battle can grind for half an hour and end in nothing.
 * The check is therefore behavioural — fight each one and require it to reach a
 * decision — rather than a reading of the coordinates.
 */

async function breathe(tick: number): Promise<void> {
  if (tick % 2_000 !== 0) return;
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const NEW_OPERATIONS: readonly ScenarioId[] = [
  'cinder_road',
  'ashen_gate',
  'goldmere_fields',
  'the_long_causeway',
];

describe('operations away from the Vale', () => {
  for (const scenarioId of NEW_OPERATIONS) {
    it(`${scenarioId} reaches a decision under an aggressive commander`, async () => {
      const scenario = SCENARIOS[scenarioId];
      const map = BATTLE_MAPS[scenario.mapId];
      const engine = new SimulationEngine({ scenarioId, difficultyId: 'captain' });
      const state = engine.getState();

      // Deliberately crude: take whichever way through the map comes first,
      // then drive everything at the enemy command seat. A plan this blunt
      // should still produce a battle that ends.
      const firstCrossing = map.zones.find((zone) => zone.crossing)?.id ?? map.enemyHomeZone;

      for (let tick = 0; tick < TICKS_PER_SECOND * 60 * 12; tick += 1) {
        await breathe(tick);
        if (tick === 30 * TICKS_PER_SECOND) {
          engine.dispatch('human', {
            type: 'order_groups',
            playerId: 'player',
            groupIds: ['legion_i', 'legion_ii', 'spearwall', 'archers_i'],
            order: 'attack_zone',
            targetZone: firstCrossing,
          });
        }
        if (tick === 240 * TICKS_PER_SECOND) {
          engine.dispatch('human', {
            type: 'order_groups',
            playerId: 'player',
            groupIds: ['legion_i', 'legion_ii', 'spearwall', 'reserve_i', 'cavalry_i', 'cavalry_ii'],
            order: 'attack_zone',
            targetZone: map.enemyHomeZone,
          });
        }
        engine.step();
        if (state.objective.outcome !== 'ongoing') break;
      }

      expect(state.objective.outcome).not.toBe('ongoing');
      expect(state.objective.outcomeReason.length).toBeGreaterThan(0);
    },
    // These march a full army for eight or nine minutes of game time before
    // anything concedes. The Long Causeway needs about ten thousand ticks, which
    // sat close enough to the suite's default sixty seconds to fail on a busy
    // machine while the battle itself was perfectly healthy. The assertion is
    // that the operation reaches a decision, not that it does so quickly.
    150_000);
  }

  it('keeps two battles on two maps out of each other’s geography', () => {
    // The active map is a cache, so the failure this guards against is subtle:
    // two engines in one process, one map pointer, and a regiment in the Vale
    // pathing around a mere in Goldmere. Interleaving must change nothing.
    const solo = new SimulationEngine({ scenarioId: 'riverwatch', seed: 4242 });
    for (let tick = 0; tick < 400; tick += 1) solo.step();
    const alone = stateChecksum(solo.getState());

    const vale = new SimulationEngine({ scenarioId: 'riverwatch', seed: 4242 });
    const plain = new SimulationEngine({ scenarioId: 'goldmere_fields', seed: 99 });
    for (let tick = 0; tick < 400; tick += 1) {
      vale.step();
      plain.step();
    }

    expect(stateChecksum(vale.getState())).toBe(alone);
    expect(vale.getState().mapId).toBe('river_vale');
    expect(plain.getState().mapId).toBe('goldmere');
  });

  it('fights each operation on its own ground and offers only that ground', () => {
    for (const scenarioId of NEW_OPERATIONS) {
      const scenario = SCENARIOS[scenarioId];
      const engine = new SimulationEngine({ scenarioId, difficultyId: 'captain' });

      expect(engine.getState().mapId).toBe(scenario.mapId);

      // The tool surface is built from this, so it must be the map's zones and
      // nothing else: offering a name that is not on the field misinforms.
      const offered = new Set(activeZoneIds());
      expect(offered.size).toBe(BATTLE_MAPS[scenario.mapId].zones.length);
      for (const zone of BATTLE_MAPS[scenario.mapId].zones) {
        expect(offered.has(zone.id), `${zone.id} missing from ${scenario.mapId}`).toBe(true);
      }
    }
  });
});
