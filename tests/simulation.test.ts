import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/game/simulation/Engine';
import { stateChecksum } from '../src/game/simulation/GameState';
import { activeGroups } from '../src/game/simulation/GameState';
import { TICKS_PER_SECOND } from '../src/game/config/battle';

function run(engine: SimulationEngine, ticks: number): void {
  for (let tick = 0; tick < ticks; tick += 1) engine.step();
}

describe('scenario', () => {
  it('deploys both armies with thousands of units', () => {
    const engine = new SimulationEngine();
    const state = engine.getState();

    const player = activeGroups(state, 'player');
    const enemy = activeGroups(state, 'enemy');

    expect(player.length).toBe(9);
    expect(enemy.length).toBe(9);

    const total = state.units.livingCount();
    expect(total).toBeGreaterThan(7000);
    expect(total).toBeLessThan(10_000);
  });

  it('holds position before the enemy commits', () => {
    const engine = new SimulationEngine();
    const state = engine.getState();
    const before = state.units.livingCount();

    run(engine, TICKS_PER_SECOND * 10);

    // The opening is quiet: the two lines are far apart and nothing is in range.
    expect(state.units.livingCount()).toBe(before);
  });

  it('produces casualties once the scripted assault lands', () => {
    const engine = new SimulationEngine();
    const state = engine.getState();
    const before = state.units.livingCount();

    run(engine, TICKS_PER_SECOND * 120);

    expect(state.units.livingCount()).toBeLessThan(before);
    expect(state.alerts.length).toBeGreaterThan(0);
  });
});

describe('determinism', () => {
  it('reaches an identical checksum from the same seed', () => {
    const first = new SimulationEngine(4242);
    const second = new SimulationEngine(4242);

    run(first, 600);
    run(second, 600);

    expect(stateChecksum(first.getState())).toBe(stateChecksum(second.getState()));
  });

  it('reaches an identical checksum with an identical command script', () => {
    const script = (engine: SimulationEngine): void => {
      run(engine, 40);
      engine.dispatch('human', {
        type: 'order_groups',
        playerId: 'player',
        groupIds: ['cavalry_i'],
        order: 'attack_zone',
        targetZone: 'west_crossing',
      });
      run(engine, 200);
      engine.dispatch('human', {
        type: 'change_formation',
        playerId: 'player',
        groupIds: ['legion_i'],
        formation: 'square',
      });
      run(engine, 200);
    };

    const first = new SimulationEngine(99);
    const second = new SimulationEngine(99);
    script(first);
    script(second);

    expect(stateChecksum(first.getState())).toBe(stateChecksum(second.getState()));
  });
});

describe('performance', () => {
  it('simulates a full battle faster than real time', () => {
    const engine = new SimulationEngine();
    const ticks = 600;

    const started = performance.now();
    run(engine, ticks);
    const elapsed = performance.now() - started;
    const perTick = elapsed / ticks;

    // The budget is the 50ms fixed step. Asserting half of it catches a real
    // regression while tolerating a loaded machine: test files run in parallel,
    // so a tighter wall-clock bound here is flaky rather than informative.
    expect(perTick).toBeLessThan(25);
    // eslint-disable-next-line no-console
    console.log(
      `${ticks} ticks in ${elapsed.toFixed(0)}ms (${(elapsed / ticks).toFixed(2)}ms/tick), ` +
        `${engine.getState().units.livingCount()} units alive`,
    );
  });
});
