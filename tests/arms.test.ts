import { describe, expect, it } from 'vitest';
import {
  CATEGORY_TOKEN,
  COUNTER_MATRIX,
  FIELD_SUPPORT,
  TICKS_PER_SECOND,
  UNIT_STATS,
  counterMultiplier,
} from '../src/game/config/battle';
import { GameQueries } from '../src/game/queries/GameQueries';
import { SimulationEngine } from '../src/game/simulation/Engine';
import { advanceFieldSupport } from '../src/game/simulation/FieldSupport';
import { findGroup, type GameState } from '../src/game/simulation/GameState';
import { UNIT_CATEGORIES, type ArmyGroup } from '../src/game/types/domain';

/**
 * The arms added to the order of battle: the guns, the shot and the surgeons.
 *
 * What is asserted here is the thing each one exists for. A gun that fires on
 * the march is a longer-ranged siege engine and nothing more; a hospital that
 * works in contact makes standing in the line free; and shot that cannot get
 * through armour has no reason to be on the field beside a bow.
 */

/** Every cannon in the army, wherever it stands. */
function guns(state: GameState): number[] {
  const found: number[] = [];
  for (let index = 0; index < state.units.count; index += 1) {
    if (state.units.alive[index] !== 1) continue;
    if (state.units.categoryOf(index) === 'cannon') found.push(index);
  }
  return found;
}

describe('the order of battle', () => {
  it('describes every troop type it offers', () => {
    // A category half-added is worse than one not added at all: it would deploy,
    // fight, and be reported as infantry everywhere a commander looked.
    for (const category of UNIT_CATEGORIES) {
      expect(UNIT_STATS[category], category).toBeDefined();
      expect(UNIT_STATS[category].label.length, category).toBeGreaterThan(0);
      expect(CATEGORY_TOKEN[category], category).toHaveLength(3);
      expect(COUNTER_MATRIX[category], category).toBeDefined();
    }

    // Tokens are read at a glance beside a name, so two arms sharing one would
    // be worse than no token at all.
    const tokens = UNIT_CATEGORIES.map((category) => CATEGORY_TOKEN[category]);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('gives shot the armour bows have never had an answer to', () => {
    // The reason to field handgunners beside archers at all: a ball goes
    // through plate a shaft turns on.
    expect(counterMultiplier('handgunner', 'heavy_infantry')).toBeGreaterThan(1);
    expect(counterMultiplier('archer', 'heavy_infantry')).toBeLessThan(1);

    // And the reason not to field only handgunners: half the reach, and more
    // than twice as long between shots.
    expect(UNIT_STATS.handgunner.range).toBeLessThan(UNIT_STATS.archer.range);
    expect(UNIT_STATS.handgunner.cooldownTicks).toBeGreaterThan(UNIT_STATS.archer.cooldownTicks * 2);
  });

  it('makes counter-battery the answer to a battery', () => {
    expect(counterMultiplier('cannon', 'siege')).toBeGreaterThan(1.5);
    expect(counterMultiplier('cannon', 'cannon')).toBeGreaterThan(1.25);
    // The other answer: horse, which a gun can barely hit.
    expect(counterMultiplier('cannon', 'cavalry')).toBeLessThan(0.75);
    expect(counterMultiplier('cavalry', 'cannon')).toBeGreaterThan(2);
    // And it outranges everything else on the field, which is why it is worth
    // the trouble of placing at all.
    expect(UNIT_STATS.cannon.range).toBeGreaterThan(UNIT_STATS.siege.range);
  });
});

describe('artillery', () => {
  it('cannot fire while it is still on the road', () => {
    // The whole distinction between a gun and a siege engine. A piece that has
    // moved this tick has its wait reset, so a battery walked forward with the
    // advance shoots at nothing for the entire march.
    const engine = new SimulationEngine({ scenarioId: 'bridge_of_knives', difficultyId: 'captain', seed: 4 });
    const state = engine.getState();
    const deploy = UNIT_STATS.cannon.deployTicks;
    expect(deploy).toBeGreaterThan(0);

    engine.dispatch('human', {
      type: 'order_groups',
      playerId: 'player',
      groupIds: ['culverins'],
      order: 'attack_zone',
      targetZone: 'central_bridge',
    });

    let sawARollingGun = false;
    for (let tick = 0; tick < TICKS_PER_SECOND * 90; tick += 1) {
      engine.step();
      for (const index of guns(state)) {
        const speed = Math.hypot(state.units.velocityX[index] ?? 0, state.units.velocityY[index] ?? 0);
        if (speed <= UNIT_STATS.cannon.speed * 0.2) continue;
        sawARollingGun = true;
        // A gun still rolling is limbered by definition: its wait was set back
        // to the full unlimbering time on this very tick.
        expect(state.units.cooldown[index]).toBe(deploy);
      }
    }
    expect(sawARollingGun).toBe(true);
  });

  it('fires once it has been given ground to stand on', () => {
    // A gun only ever reaches the full reload by actually loosing a shot, so a
    // wait longer than the unlimbering time is proof the battery is in action.
    const engine = new SimulationEngine({ scenarioId: 'bridge_of_knives', difficultyId: 'captain', seed: 4 });
    const state = engine.getState();

    engine.dispatch('human', {
      type: 'order_groups',
      playerId: 'player',
      groupIds: ['vanguard', 'ironbacks', 'hedge'],
      order: 'attack_zone',
      targetZone: 'central_bridge',
    });
    engine.dispatch('human', {
      type: 'focus_siege',
      playerId: 'player',
      siegeGroupId: 'culverins',
      targetZone: 'central_bridge',
    });

    let fired = false;
    for (let tick = 0; tick < TICKS_PER_SECOND * 300 && !fired; tick += 1) {
      engine.step();
      for (const index of guns(state)) {
        if ((state.units.cooldown[index] ?? 0) > UNIT_STATS.cannon.deployTicks) fired = true;
      }
    }
    expect(fired).toBe(true);
  });

  it('tells the commander his guns are still on their teams', () => {
    const engine = new SimulationEngine({ scenarioId: 'bridge_of_knives', difficultyId: 'captain', seed: 4 });
    const queries = new GameQueries(() => engine.getState());

    const before = queries.getArmies('player').find((army) => army.id === 'culverins');
    expect(before?.limbered).toBe(false);

    engine.dispatch('human', {
      type: 'order_groups',
      playerId: 'player',
      groupIds: ['culverins'],
      order: 'attack_zone',
      targetZone: 'central_bridge',
    });
    engine.step();

    const marching = queries.getArmies('player').find((army) => army.id === 'culverins');
    expect(marching?.limbered).toBe(true);

    // Nothing without guns in it is ever reported as limbered, however far it
    // is marching.
    const legion = queries.getArmies('player').find((army) => army.id === 'vanguard');
    expect(legion?.limbered).toBe(false);
  });
});

/** Cuts a regiment about and wears it out, without fighting a battle for it. */
function batter(state: GameState, group: ArmyGroup): void {
  group.fatigue = 0.8;
  group.morale = 45;
  for (const index of group.members) {
    state.units.hp[index] = 20;
  }
}

/** Puts a group's anchor and every man in it on a piece of ground. */
function station(state: GameState, group: ArmyGroup, x: number, y: number): void {
  group.anchor.x = x;
  group.anchor.y = y;
  group.path = [];
  for (const index of group.members) {
    state.units.x[index] = x;
    state.units.y[index] = y;
    state.units.slotX[index] = x;
    state.units.slotY[index] = y;
  }
}

/**
 * Rests a battered reserve for a minute, with the hospital where the caller
 * puts it, and reports what it got back.
 */
function convalesce(hospitalX: number, hospitalY: number): {
  hp: number;
  fatigue: number;
  morale: number;
  succour: number;
} {
  const engine = new SimulationEngine({ scenarioId: 'bridge_of_knives', difficultyId: 'captain', seed: 7 });
  const state = engine.getState();
  const reserve = findGroup(state, 'fenmen');
  const hospital = findGroup(state, 'field_hospital');
  if (reserve === undefined || hospital === undefined) throw new Error('missing regiment');

  // Well behind the line and well apart from everything else, so the only
  // thing that differs between the two runs is where the surgeons are.
  station(state, reserve, 2000, 4500);
  batter(state, reserve);
  station(state, hospital, hospitalX, hospitalY);

  for (let tick = 0; tick < TICKS_PER_SECOND * 60; tick += 1) engine.step();

  let hp = 0;
  for (const index of reserve.members) hp += state.units.hp[index] ?? 0;
  return {
    hp: hp / Math.max(1, reserve.members.length),
    fatigue: reserve.fatigue,
    morale: reserve.morale,
    succour: reserve.succour,
  };
}

describe('the field hospital', () => {
  it('gets a battered regiment back on its feet faster than it would alone', () => {
    const tended = convalesce(2100, 4600);
    const alone = convalesce(6800, 900);

    expect(tended.succour).toBeGreaterThan(FIELD_SUPPORT.reportThreshold);
    expect(alone.succour).toBe(0);

    // The wounded, the wind and the nerve, in that order.
    expect(tended.hp).toBeGreaterThan(alone.hp + 5);
    expect(tended.fatigue).toBeLessThan(alone.fatigue);
    expect(tended.morale).toBeGreaterThan(alone.morale);
  });

  it('does nothing whatever for men who are still fighting', () => {
    // Care has to be something a commander buys by pulling a regiment out. If
    // it also arrived by leaving one in, holding ground would simply be free.
    const engine = new SimulationEngine({ scenarioId: 'bridge_of_knives', difficultyId: 'captain', seed: 7 });
    const state = engine.getState();
    const reserve = findGroup(state, 'fenmen');
    const hospital = findGroup(state, 'field_hospital');
    if (reserve === undefined || hospital === undefined) throw new Error('missing regiment');

    station(state, reserve, 2000, 4500);
    station(state, hospital, 2100, 4600);
    engine.step();
    expect(reserve.succour).toBeGreaterThan(0);

    // Driven straight, because `Combat` writes engagement immediately before
    // the surgeons read it and would overwrite anything set here from outside.
    reserve.engagement = 0.5;
    advanceFieldSupport(state);
    expect(reserve.succour).toBe(0);
  });

  it('reports care on the roster the commander actually reads', () => {
    const engine = new SimulationEngine({ scenarioId: 'bridge_of_knives', difficultyId: 'captain', seed: 7 });
    const queries = new GameQueries(() => engine.getState());
    const state = engine.getState();
    const reserve = findGroup(state, 'fenmen');
    const hospital = findGroup(state, 'field_hospital');
    if (reserve === undefined || hospital === undefined) throw new Error('missing regiment');

    station(state, reserve, 2000, 4500);
    station(state, hospital, 2100, 4600);
    engine.step();

    const row = queries.getArmies('player').find((army) => army.id === 'fenmen');
    expect(row?.tended).toBe(true);
  });

  it('carries no weapon and holds no ground', () => {
    // A hospital must never be usable as a blocking force, so nothing in it
    // ever acquires a target or pins anybody by standing there.
    expect(UNIT_STATS.surgeon.attack).toBe(0);

    const engine = new SimulationEngine({ scenarioId: 'bridge_of_knives', difficultyId: 'captain', seed: 7 });
    const state = engine.getState();
    const hospital = findGroup(state, 'field_hospital');
    const ironHost = findGroup(state, 'cinder_host');
    if (hospital === undefined || ironHost === undefined) throw new Error('missing regiment');

    // Stood directly in front of an enemy regiment, which would be suicide and
    // is meant to be.
    station(state, hospital, ironHost.anchor.x, ironHost.anchor.y + 60);
    for (let tick = 0; tick < TICKS_PER_SECOND * 5; tick += 1) engine.step();

    for (const index of hospital.members) {
      expect(state.units.targetIdx[index]).toBe(-1);
    }
    expect(hospital.engagement).toBe(0);
  });
});
