import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND, MAP_HEIGHT, MAP_WIDTH } from '../src/game/config/battle';
import { BATTLE_MAPS } from '../src/game/config/maps';
import { SCENARIOS } from '../src/game/config/scenario';
import {
  CustomOperationError,
  buildCustomOperation,
  createSkirmishDraft,
  createSkirmishOperation,
  type CustomOperationSpec,
} from '../src/game/config/customBattle';
import { BATTLE_MAP_IDS } from '../src/game/config/maps';
import { AUTHORED_SCENARIO_IDS } from '../src/game/config/matches';
import { SimulationEngine } from '../src/game/simulation/Engine';
import { stateChecksum } from '../src/game/simulation/GameState';
import { activeZoneIds, isPassable, useBattleMap } from '../src/game/simulation/Zones';

/**
 * The operations, authored and designed.
 *
 * An operation can be geometrically sound and still unplayable: the enemy
 * script can name ground his army cannot reach, the two sides can deploy where
 * they never meet, and a battle can grind for a quarter of an hour and end in
 * nothing. The check is therefore behavioural — fight each one with a blunt
 * plan and require it to reach a decision — rather than a reading of the
 * coordinates.
 *
 * A designed operation is held to exactly the same standard, because the whole
 * claim of the War Council tools is that a battle written by an agent is a
 * battle in every sense the authored three are.
 */

async function breathe(tick: number): Promise<void> {
  if (tick % 2_000 !== 0) return;
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Drives one army straight through the first gap it finds at the enemy seat. */
async function fightToADecision(engine: SimulationEngine, minutes = 14): Promise<void> {
  const state = engine.getState();
  const map = BATTLE_MAPS[state.mapId];
  const crossing = map.zones.find((zone) => zone.crossing)?.id ?? map.enemyHomeZone;
  const mine = state.groups.filter((group) => group.ownerId === 'player').map((group) => group.id);

  for (let tick = 0; tick < TICKS_PER_SECOND * 60 * minutes; tick += 1) {
    await breathe(tick);
    if (tick === 30 * TICKS_PER_SECOND) {
      engine.dispatch('human', {
        type: 'order_groups',
        playerId: 'player',
        groupIds: mine.slice(0, 4),
        order: 'attack_zone',
        targetZone: crossing,
      });
    }
    if (tick === 240 * TICKS_PER_SECOND) {
      engine.dispatch('human', {
        type: 'order_groups',
        playerId: 'player',
        groupIds: mine.slice(0, 8),
        order: 'attack_zone',
        targetZone: map.enemyHomeZone,
      });
    }
    engine.step();
    if (state.objective.outcome !== 'ongoing') break;
  }
}

describe('the authored operations', () => {
  for (const scenarioId of AUTHORED_SCENARIO_IDS) {
    it(`${scenarioId} reaches a decision under an aggressive commander`, async () => {
      const engine = new SimulationEngine({ scenarioId, difficultyId: 'captain' });
      await fightToADecision(engine);

      expect(engine.getState().objective.outcome).not.toBe('ongoing');
      expect(engine.getState().objective.outcomeReason.length).toBeGreaterThan(0);
    });
  }

  it('fights each operation on its own ground and offers only that ground', () => {
    for (const scenarioId of AUTHORED_SCENARIO_IDS) {
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

  it('gives every operation the trick that makes it itself', () => {
    for (const scenarioId of AUTHORED_SCENARIO_IDS) {
      const scenario = SCENARIOS[scenarioId];
      expect(scenario.origin).toBe('authored');
      expect(scenario.twist.length).toBeGreaterThan(10);
      expect(scenario.battleOrders.length).toBeGreaterThan(0);
      // Both sovereigns must be on the field, or the objective cannot resolve.
      expect(scenario.kingSpecs.map((king) => king.ownerId).sort()).toEqual(['enemy', 'player']);
    }
  });

  it('keeps two battles on two maps out of each other’s geography', () => {
    // The active map is a cache, so the failure this guards against is subtle:
    // two engines in one process, one map pointer, and a regiment in the Vale
    // pathing around the spine of Ashfall. Interleaving must change nothing.
    const solo = new SimulationEngine({ scenarioId: 'bridge_of_knives', seed: 4242 });
    for (let tick = 0; tick < 400; tick += 1) solo.step();
    const alone = stateChecksum(solo.getState());

    const vale = new SimulationEngine({ scenarioId: 'bridge_of_knives', seed: 4242 });
    const pass = new SimulationEngine({ scenarioId: 'ember_gate', seed: 99 });
    for (let tick = 0; tick < 400; tick += 1) {
      vale.step();
      pass.step();
    }

    expect(stateChecksum(vale.getState())).toBe(alone);
    expect(vale.getState().mapId).toBe('river_vale');
    expect(pass.getState().mapId).toBe('ashfall_pass');
  });
});

describe('designed operations', () => {
  const designed = createSkirmishOperation('goldmere');

  it('builds a whole operation out of a submitted design', () => {
    expect(designed.id).toBe('custom');
    expect(designed.origin).toBe('designed');
    expect(designed.mapId).toBe('goldmere');
    expect(designed.playerGroups.length).toBe(createSkirmishDraft('goldmere').playerRegiments.length);
    expect(designed.enemyGroups.length).toBe(createSkirmishDraft('goldmere').enemyRegiments.length);
    expect(designed.kingSpecs.map((king) => king.guardGroupId)).toEqual([
      'crown_guard',
      'ashen_guard',
    ]);
    // The commander reads his timetable in order whatever order it arrived in.
    const seconds = designed.aiScript.map((entry) => entry.atSeconds);
    expect([...seconds].sort((a, b) => a - b)).toEqual(seconds);
  });

  it('deploys every designed regiment on legal ground', () => {
    const engine = new SimulationEngine({
      scenarioId: 'custom',
      scenario: designed,
      difficultyId: 'captain',
    });
    const state = engine.getState();
    useBattleMap(state.mapId);

    for (const group of state.groups) {
      expect(group.members.length).toBeGreaterThan(0);
      expect(group.anchor.x).toBeGreaterThan(200);
      expect(group.anchor.x).toBeLessThan(MAP_WIDTH - 200);
      expect(group.anchor.y).toBeGreaterThan(200);
      expect(group.anchor.y).toBeLessThan(MAP_HEIGHT - 200);
    }
    for (let index = 0; index < state.units.count; index += 1) {
      if (state.units.alive[index] !== 1) continue;
      expect(isPassable(state.units.x[index] ?? -1, state.units.y[index] ?? -1)).toBe(true);
    }
  });

  it('fights a designed operation to a decision like any other', async () => {
    const engine = new SimulationEngine({
      scenarioId: 'custom',
      scenario: designed,
      difficultyId: 'captain',
      seed: 512,
    });
    await fightToADecision(engine);
    expect(engine.getState().objective.outcome).not.toBe('ongoing');
  });

  it('runs a designed battle beside an authored one without either bleeding into the other', () => {
    const solo = new SimulationEngine({ scenarioId: 'bridge_of_knives', seed: 77 });
    for (let tick = 0; tick < 300; tick += 1) solo.step();
    const alone = stateChecksum(solo.getState());

    const vale = new SimulationEngine({ scenarioId: 'bridge_of_knives', seed: 77 });
    const table = new SimulationEngine({ scenarioId: 'custom', scenario: designed, seed: 5 });
    for (let tick = 0; tick < 300; tick += 1) {
      vale.step();
      table.step();
    }

    expect(stateChecksum(vale.getState())).toBe(alone);
    expect(table.getState().scenario.name).toBe('Free Field');
  });

  it('lays a legal blank battle on every battlefield', () => {
    for (const mapId of BATTLE_MAP_IDS) {
      const table = createSkirmishOperation(mapId);
      expect(table.mapId).toBe(mapId);
      expect(table.playerGroups.length).toBe(7);
      expect(table.enemyGroups.length).toBe(7);

      const engine = new SimulationEngine({ scenarioId: 'custom', scenario: table, seed: 21 });
      const state = engine.getState();
      useBattleMap(state.mapId);

      // Both sides raised, on their own halves, and nobody standing in water.
      expect(state.groups.filter((group) => group.ownerId === 'player')).toHaveLength(7);
      expect(state.groups.filter((group) => group.ownerId === 'enemy')).toHaveLength(7);
      for (let index = 0; index < state.units.count; index += 1) {
        if (state.units.alive[index] !== 1) continue;
        expect(
          isPassable(state.units.x[index] ?? -1, state.units.y[index] ?? -1),
          `${mapId} spawns a soldier on impassable ground`,
        ).toBe(true);
      }
      // And the enemy's timetable names ground that is actually on this map.
      const zones = new Set(BATTLE_MAPS[mapId].zones.map((zone) => zone.id));
      for (const order of table.aiScript) {
        expect(order.targetZone === undefined || zones.has(order.targetZone)).toBe(true);
      }
    }
  });

  it('rejects one id used on both sides, which the roster could not tell apart', () => {
    const draft = structuredClone(createSkirmishDraft('goldmere'));
    expect(() =>
      buildCustomOperation({
        ...draft,
        enemyRegiments: draft.enemyRegiments.map((regiment, index) =>
          index === 0 ? { ...regiment, id: 'crown_centre' } : regiment,
        ),
      }),
    ).toThrow(/on both sides/);
  });

  it('seats the designed enemy guard from the design, not from a written id', () => {
    const engine = new SimulationEngine({ scenarioId: 'custom', scenario: designed, seed: 3 });
    for (let tick = 0; tick < 40; tick += 1) engine.step();
    const guard = engine.getState().groups.find((group) => group.id === 'ashen_guard');
    expect(guard?.order.kind).toBe('defend_zone');
  });
});

describe('rejected designs', () => {
  const withPlayer = (
    change: (spec: CustomOperationSpec) => CustomOperationSpec,
  ): (() => unknown) => {
    return () => buildCustomOperation(change(structuredClone(createSkirmishDraft('goldmere'))));
  };

  it('refuses a side with no sovereign on it', () => {
    expect(
      withPlayer((spec) => ({
        ...spec,
        playerRegiments: spec.playerRegiments.map((regiment) => ({
          ...regiment,
          carriesKing: false,
        })),
      })),
    ).toThrow(CustomOperationError);
  });

  it('refuses an army that would not fit on the field', () => {
    expect(
      withPlayer((spec) => ({
        ...spec,
        enemyRegiments: spec.enemyRegiments.map((regiment) => ({
          ...regiment,
          troops: [{ category: 'infantry' as const, count: 1200 }],
        })),
      })),
    ).toThrow(/more than/);
  });

  it('refuses ground that is not on the chosen battlefield', () => {
    expect(
      withPlayer((spec) => ({
        ...spec,
        playerRegiments: spec.playerRegiments.map((regiment, index) =>
          index === 0 ? { ...regiment, zone: 'central_bridge' as const } : regiment,
        ),
      })),
    ).toThrow(/not on Goldmere/);
  });

  it('refuses a commander ordering a regiment that does not exist', () => {
    expect(
      withPlayer((spec) => ({
        ...spec,
        enemyPlan: [
          { atSeconds: 30, groupId: 'ghost_column', order: 'attack_zone', targetZone: 'millbrook' },
        ],
      })),
    ).toThrow(/not an enemy regiment/);
  });

  it('refuses an order that names no ground to march to', () => {
    expect(
      withPlayer((spec) => ({
        ...spec,
        enemyPlan: [{ atSeconds: 30, groupId: 'ashen_centre', order: 'attack_zone' }],
      })),
    ).toThrow(/needs a "targetZone"/);
  });
});
