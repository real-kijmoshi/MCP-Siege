import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../src/game/config/battle';
import { BATTLE_MAPS } from '../src/game/config/maps';
import { SCENARIO_IDS } from '../src/game/config/matches';
import { SCENARIOS } from '../src/game/config/scenario';
import { SimulationEngine } from '../src/game/simulation/Engine';
import { activeGroups } from '../src/game/simulation/GameState';
import { computePath, hasClearLineOfMarch } from '../src/game/simulation/Navigation';
import { ZONES, activeZoneIds, isPassable, useBattleMap } from '../src/game/simulation/Zones';

/**
 * Navigation, as the thing that has to keep working rather than as an algorithm.
 *
 * The interesting failure was never that a route could not be found. It was
 * that a route found once stayed the plan long after it had stopped describing
 * where the regiment actually was, and nothing ever noticed.
 */

/** Marches everything the player owns at the far side of the map. */
function orderGeneralAdvance(engine: SimulationEngine): void {
  const state = engine.getState();
  const map = BATTLE_MAPS[SCENARIOS[state.scenarioId].mapId];
  engine.dispatch('human', {
    type: 'order_groups',
    playerId: 'player',
    groupIds: activeGroups(state, 'player')
      .filter((group) => group.id !== 'royal_guard')
      .map((group) => group.id),
    order: 'attack_zone',
    targetZone: map.enemyHomeZone,
  });
}

describe('route planning', () => {
  it.each(SCENARIO_IDS)('connects every pair of zones on %s over open ground', (scenarioId) => {
    useBattleMap(SCENARIOS[scenarioId].mapId);
    const zoneIds = activeZoneIds();

    for (const from of zoneIds) {
      for (const to of zoneIds) {
        if (from === to) continue;
        const origin = ZONES[from].center;
        const destination = ZONES[to].center;
        const path = computePath(origin, destination, 60);

        let cursor = origin;
        for (const waypoint of path) {
          expect(
            hasClearLineOfMarch(cursor, waypoint),
            `${from} -> ${to} crosses impassable ground`,
          ).toBe(true);
          cursor = waypoint;
        }
        // A route that stops short of where it was asked to go is not a route.
        expect(Math.hypot(cursor.x - destination.x, cursor.y - destination.y)).toBeLessThan(1);
      }
    }
  });
});

describe('marching', () => {
  it('re-routes a regiment whose planned line has stopped describing its march', () => {
    // A whole army pushed through one crossing is the case that broke this: the
    // press of friendly regiments walks a column off the line it was routed
    // along, and the line it was given then runs into the bank instead of onto
    // the bridge. It used to stand there for the rest of the battle.
    const engine = new SimulationEngine({ scenarioId: 'riverwatch', difficultyId: 'captain', seed: 5 });
    const state = engine.getState();

    let worstBlockedRun = 0;
    const blockedFor = new Map<string, number>();

    for (let tick = 0; tick < TICKS_PER_SECOND * 300; tick += 1) {
      if (tick === TICKS_PER_SECOND * 20) orderGeneralAdvance(engine);
      engine.step();
      if (state.objective.outcome !== 'ongoing') break;

      for (const group of state.groups) {
        const waypoint = group.path[0];
        if (group.members.length === 0 || waypoint === undefined) {
          blockedFor.delete(group.id);
          continue;
        }
        if (hasClearLineOfMarch(group.anchor, waypoint)) {
          blockedFor.delete(group.id);
          continue;
        }
        const run = (blockedFor.get(group.id) ?? 0) + 1;
        blockedFor.set(group.id, run);
        if (run > worstBlockedRun) worstBlockedRun = run;
      }
    }

    // A leg may go stale for a moment — the audit is staggered and rate-limited
    // on purpose. What must not happen is a regiment left aimed at ground it
    // cannot reach for minutes on end.
    expect(worstBlockedRun).toBeLessThan(TICKS_PER_SECOND * 10);
  });

  it('leaves no regiment standing on ground it cannot occupy', () => {
    const engine = new SimulationEngine({ scenarioId: 'the_long_causeway', difficultyId: 'captain', seed: 3 });
    const state = engine.getState();

    for (let tick = 0; tick < TICKS_PER_SECOND * 240; tick += 1) {
      if (tick === TICKS_PER_SECOND * 20) orderGeneralAdvance(engine);
      engine.step();
      if (state.objective.outcome !== 'ongoing') break;
      if (tick % TICKS_PER_SECOND !== 0) continue;

      for (const group of state.groups) {
        if (group.members.length === 0) continue;
        expect(
          isPassable(group.anchor.x, group.anchor.y),
          `${group.id} stood in impassable ground at tick ${tick}`,
        ).toBe(true);
      }
    }
  });

  it('keeps every soldier out of the water while an army forces a crossing', () => {
    // Unit positions are stored as 32-bit floats. Testing the wider intermediate
    // let a man wedged on the lip of a bridge pass the passability check and
    // then be written a few ten-thousandths the other side of it.
    const engine = new SimulationEngine({ scenarioId: 'riverwatch', difficultyId: 'captain', seed: 5 });
    const state = engine.getState();

    for (let tick = 0; tick < TICKS_PER_SECOND * 240; tick += 1) {
      if (tick === TICKS_PER_SECOND * 20) orderGeneralAdvance(engine);
      engine.step();
      if (state.objective.outcome !== 'ongoing') break;
      if (tick % (TICKS_PER_SECOND * 5) !== 0) continue;

      let drowned = 0;
      for (let index = 0; index < state.units.capacity; index += 1) {
        if (state.units.alive[index] !== 1) continue;
        if (isPassable(state.units.x[index] ?? 0, state.units.y[index] ?? 0)) continue;
        drowned += 1;
      }
      expect(drowned, `soldiers on impassable ground at tick ${tick}`).toBe(0);
    }
  });
});
