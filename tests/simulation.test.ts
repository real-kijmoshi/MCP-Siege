import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/game/simulation/Engine';
import { stateChecksum } from '../src/game/simulation/GameState';
import { activeGroups } from '../src/game/simulation/GameState';
import { TICKS_PER_SECOND } from '../src/game/config/battle';
import { SCENARIO_IDS } from '../src/game/config/matches';

function run(engine: SimulationEngine, ticks: number): void {
  for (let tick = 0; tick < ticks; tick += 1) engine.step();
}

/**
 * Yields to the event loop periodically.
 *
 * A long battle blocks a worker for tens of seconds, and vitest's reporter RPC
 * times out behind it and fails the run even though every assertion passed.
 */
async function breathe(tick: number): Promise<void> {
  if (tick % 2_000 !== 0) return;
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('scenario', () => {
  it('deploys both armies with thousands of units', () => {
    const engine = new SimulationEngine();
    const state = engine.getState();

    const player = activeGroups(state, 'player');
    const enemy = activeGroups(state, 'enemy');

    // Nine field regiments a side, plus the Royal Guard each king rides with.
    expect(player.length).toBe(10);
    expect(enemy.length).toBe(10);
    expect(state.objective.kings.player.guardGroupId).toBe('royal_guard');
    expect(state.objective.kings.enemy.guardGroupId).toBe('ashen_guard');

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

  it.each(SCENARIO_IDS)('builds the %s operation as a complete battle', (scenarioId) => {
    const engine = new SimulationEngine({ scenarioId, difficultyId: 'captain' });
    const state = engine.getState();

    expect(state.scenarioId).toBe(scenarioId);
    expect(activeGroups(state, 'player')).toHaveLength(10);
    expect(activeGroups(state, 'enemy')).toHaveLength(10);
    expect(state.objective.initialStrength.player).toBeGreaterThan(3000);
    expect(state.objective.initialStrength.enemy).toBeGreaterThan(3000);
    expect(state.objective.kings.player.guardGroupId).toBe('royal_guard');
    expect(state.objective.kings.enemy.guardGroupId).toBe('ashen_guard');
  });

  it('gives each operation a materially different opening deployment', () => {
    const riverwatch = new SimulationEngine({ scenarioId: 'riverwatch' }).getState();
    const bridgehead = new SimulationEngine({ scenarioId: 'broken_bridgehead' }).getState();
    const lastLight = new SimulationEngine({ scenarioId: 'last_light' }).getState();

    expect(riverwatch.groupIndexById.get('legion_i')).toBeDefined();
    const riverLegion = riverwatch.groups[riverwatch.groupIndexById.get('legion_i') ?? -1];
    const bridgeLegion = bridgehead.groups[bridgehead.groupIndexById.get('legion_i') ?? -1];
    const lastLegion = lastLight.groups[lastLight.groupIndexById.get('legion_i') ?? -1];

    expect(riverLegion?.anchor.y).toBe(3150);
    expect(bridgeLegion?.anchor.y).toBe(2050);
    expect(lastLegion?.anchor.y).toBe(3850);
  });

  it('changes enemy initiative timing with difficulty', () => {
    // Asserted as an ordering rather than against fixed clock times: the
    // absolute tempo is a balance figure that gets retuned, but a harder
    // commander committing sooner than an easier one is the actual contract.
    const commitmentSecond = (difficultyId: 'levy' | 'captain' | 'warlord'): number => {
      const engine = new SimulationEngine({ difficultyId });
      const state = engine.getState();
      for (let tick = 0; tick < TICKS_PER_SECOND * 120; tick += 1) {
        engine.step();
        const group = state.groups[state.groupIndexById.get('iron_host') ?? -1];
        if (group !== undefined && group.order.kind !== 'idle') return tick / TICKS_PER_SECOND;
      }
      return Number.POSITIVE_INFINITY;
    };

    const warlord = commitmentSecond('warlord');
    const captain = commitmentSecond('captain');
    const levy = commitmentSecond('levy');

    expect(warlord).toBeLessThan(captain);
    expect(captain).toBeLessThan(levy);
    expect(levy).toBeLessThan(90);
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

describe('morale', () => {
  it('breaks a regiment long before it is annihilated', async () => {
    // The tactical model is meant to be decided by formations giving way. A
    // regiment that fights to the last man while reporting good morale means
    // the whole morale layer is inert, which is what used to happen.
    const engine = new SimulationEngine({ difficultyId: 'warlord' });
    const state = engine.getState();

    const legion = (): (typeof state.groups)[number] | undefined =>
      state.groups[state.groupIndexById.get('legion_i') ?? -1];

    const initial = legion()?.initialStrength ?? 0;
    expect(initial).toBeGreaterThan(500);

    engine.dispatch('human', {
      type: 'order_groups',
      playerId: 'player',
      groupIds: ['legion_i'],
      order: 'attack_zone',
      targetZone: 'central_field',
    });

    let brokeAt = -1;
    for (let tick = 0; tick < TICKS_PER_SECOND * 60 * 8; tick += 1) {
      await breathe(tick);
      engine.step();
      const group = legion();
      if (group === undefined || group.members.length === 0) break;
      if (group.routing) {
        brokeAt = group.members.length / initial;
        break;
      }
    }

    expect(brokeAt, 'legion_i never broke').toBeGreaterThan(0);
    // It should still be a regiment when it quits the field, not a remnant.
    expect(brokeAt).toBeGreaterThan(0.15);
  });

  it('will not let a shattered regiment recover full confidence', async () => {
    const engine = new SimulationEngine();
    const state = engine.getState();
    const group = state.groups[state.groupIndexById.get('scouts') ?? -1];
    expect(group).toBeDefined();
    if (group === undefined) return;

    // Cut it to a tenth of its strength and leave it entirely alone.
    const survivors = group.members.slice(0, Math.max(1, Math.round(group.initialStrength * 0.1)));
    for (const index of group.members) {
      if (!survivors.includes(index)) state.units.kill(index);
    }
    group.members = survivors;
    group.morale = 100;

    for (let tick = 0; tick < TICKS_PER_SECOND * 120; tick += 1) {
      await breathe(tick);
      engine.step();
    }

    expect(group.morale).toBeLessThan(60);
  });
});

describe('battle tempo', () => {
  it('reaches a decision rather than grinding to a permanent stalemate', async () => {
    // An untouched battle used to run for twenty minutes and end in nothing:
    // both armies fought to half strength, every enemy regiment finished its
    // scripted order, and nothing ever asked it for another one.
    const engine = new SimulationEngine({ difficultyId: 'captain' });
    const state = engine.getState();

    const script: Array<[number, string[], 'central_field' | 'central_bridge' | 'enemy_base']> = [
      [20, ['legion_i', 'legion_ii', 'spearwall', 'archers_i'], 'central_field'],
      [120, ['legion_i', 'legion_ii', 'spearwall'], 'central_bridge'],
      [300, ['legion_i', 'legion_ii', 'reserve_i'], 'enemy_base'],
    ];

    for (let tick = 0; tick < TICKS_PER_SECOND * 60 * 25; tick += 1) {
      await breathe(tick);
      for (const [second, groupIds, targetZone] of script) {
        if (tick === second * TICKS_PER_SECOND) {
          engine.dispatch('human', {
            type: 'order_groups',
            playerId: 'player',
            groupIds,
            order: 'attack_zone',
            targetZone,
          });
        }
      }
      engine.step();
      if (state.objective.outcome !== 'ongoing') break;
    }

    expect(state.objective.outcome).not.toBe('ongoing');
  });

  it('commits the enemy against the player king once the escalation is spent', async () => {
    const engine = new SimulationEngine({ difficultyId: 'warlord' });
    const state = engine.getState();

    // Well past the warlord final-push threshold.
    for (let tick = 0; tick < TICKS_PER_SECOND * 300; tick += 1) {
      await breathe(tick);
      engine.step();
    }

    const kingZone = state.groups[state.groupIndexById.get('royal_guard') ?? -1];
    expect(kingZone).toBeDefined();

    const driving = state.groups.filter(
      (group) =>
        group !== undefined &&
        group.ownerId === 'enemy' &&
        group.members.length > 0 &&
        group.order.kind === 'attack_zone' &&
        (group.order.targetZone === 'player_base' || group.order.targetZone === 'central_field'),
    );
    expect(driving.length).toBeGreaterThan(0);
  });

  /**
   * The answer to a doomstack.
   *
   * Putting every regiment on one crossing and walking through it used to be
   * the whole game: the defenders there were outnumbered five to one, the rest
   * of the enemy army never noticed, and the rush was over long before the
   * scripted last act could punish it. A commander who sees the player's whole
   * weight in one place has to stop feeding regiments into it and go the other
   * way, at the sovereign the player has just left behind.
   */
  it('refuses a hopeless assault and marches around an army that has committed itself', async () => {
    const engine = new SimulationEngine({ difficultyId: 'captain' });
    const state = engine.getState();

    const committed = activeGroups(state, 'player')
      .filter((group) => group.id !== 'royal_guard')
      .map((group) => group.id);

    let sawOpportunism = false;
    let sawRefusal = false;

    for (let tick = 0; tick < TICKS_PER_SECOND * 260; tick += 1) {
      await breathe(tick);
      // A commander who keeps pressing the same point, and nothing else.
      if (tick % (TICKS_PER_SECOND * 30) === 0) {
        engine.dispatch('human', {
          type: 'order_groups',
          playerId: 'player',
          groupIds: committed,
          order: 'attack_zone',
          targetZone: 'central_bridge',
        });
      }
      engine.step();
      if (state.alerts.some((alert) => alert.key === 'enemy_exploits_opening')) {
        sawOpportunism = true;
      }
      // A regiment that halted its own march on the mass rather than joining it.
      if (
        state.groups.some(
          (group) =>
            group.ownerId === 'enemy' &&
            group.members.length > 0 &&
            group.order.kind === 'defend_zone' &&
            group.order.targetZone !== 'enemy_base',
        )
      ) {
        sawRefusal = true;
      }
      if (state.objective.outcome !== 'ongoing') break;
    }

    expect(sawRefusal).toBe(true);
    expect(sawOpportunism).toBe(true);
  });
});
