import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/game/simulation/Engine';
import { stateChecksum } from '../src/game/simulation/GameState';
import { activeGroups } from '../src/game/simulation/GameState';
import { TICKS_PER_SECOND } from '../src/game/config/battle';
import { AUTHORED_SCENARIO_IDS } from '../src/game/config/matches';
import {
  ASHEN_ARMY,
  CROWN_ARMY,
  SCENARIOS,
  type ScenarioDefinition,
} from '../src/game/config/scenario';
import { barrierCenterAt, useBattleMap } from '../src/game/simulation/Zones';

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

const FULL_VALE: ScenarioDefinition = {
  ...SCENARIOS.bridge_of_knives,
  id: 'custom',
  origin: 'designed',
  playerGroups: CROWN_ARMY,
  enemyGroups: ASHEN_ARMY,
  aiScript: SCENARIOS.bridge_of_knives.aiScript.filter(
    (order) => order.groupId !== 'cinder_bowmen',
  ),
};

describe('scenario', () => {
  it('deploys a readable field force with thousands of units', () => {
    const engine = new SimulationEngine();
    const state = engine.getState();

    const player = activeGroups(state, 'player');
    const enemy = activeGroups(state, 'enemy');

    expect(player.length).toBe(state.scenario.playerGroups.length);
    expect(enemy.length).toBe(state.scenario.enemyGroups.length);
    expect(player.length).toBeLessThanOrEqual(8);
    expect(enemy.length).toBeLessThanOrEqual(8);
    expect(state.objective.kings.player.guardGroupId).toBe('kingsguard');
    expect(state.objective.kings.enemy.guardGroupId).toBe('ashen_guard');

    const total = state.units.livingCount();
    expect(total).toBeGreaterThan(2500);
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

  it.each(AUTHORED_SCENARIO_IDS)('builds the %s operation as a complete battle', (scenarioId) => {
    const engine = new SimulationEngine({ scenarioId, difficultyId: 'captain' });
    const state = engine.getState();

    expect(state.scenarioId).toBe(scenarioId);
    expect(activeGroups(state, 'player')).toHaveLength(state.scenario.playerGroups.length);
    expect(activeGroups(state, 'enemy')).toHaveLength(state.scenario.enemyGroups.length);
    expect(state.scenario.playerGroups.length).toBeGreaterThanOrEqual(6);
    expect(state.scenario.playerGroups.length).toBeLessThanOrEqual(8);
    expect(state.scenario.enemyGroups.length).toBeGreaterThanOrEqual(6);
    expect(state.scenario.enemyGroups.length).toBeLessThanOrEqual(8);
    expect(state.objective.initialStrength.player).toBeGreaterThan(1500);
    expect(state.objective.initialStrength.enemy).toBeGreaterThan(1500);
    expect(state.objective.kings.player.guardGroupId).toBe('kingsguard');
    expect(state.objective.kings.enemy.guardGroupId).toBe('ashen_guard');
  });

  it.each(['bridge_of_knives'] as const)(
    'keeps the %s order of battle to two knights, one cavalry, two bows and a small guard',
    (scenarioId) => {
      const state = new SimulationEngine({ scenarioId }).getState();

      for (const playerId of ['player', 'enemy'] as const) {
        const groups = activeGroups(state, playerId);
        const guardId = state.objective.kings[playerId].guardGroupId;
        const guard = groups.find((group) => group.id === guardId);
        expect(groups).toHaveLength(6);
        expect(guard?.initialStrength).toBe(120);

        const roleOf = (group: (typeof groups)[number]): string =>
          state.units.categoryOf(group.members[0] ?? -1);
        expect(groups.filter((group) => group.id !== guardId && roleOf(group) === 'heavy_infantry')).toHaveLength(2);
        expect(groups.filter((group) => roleOf(group) === 'cavalry')).toHaveLength(1);
        expect(groups.filter((group) => roleOf(group) === 'archer')).toHaveLength(2);
      }
    },
  );

  it('gives each operation a materially different opening deployment', () => {
    // Four operations, one order of battle, four genuinely different
    // problems. If two of them stood the same regiment in the same place they
    // would be one operation with two names.
    const anchors = AUTHORED_SCENARIO_IDS.map((scenarioId) => {
      const state = new SimulationEngine({ scenarioId }).getState();
      const index = state.groupIndexById.get('vanguard') ?? -1;
      const group = state.groups[index];
      expect(group, `${scenarioId} raises no vanguard`).toBeDefined();
      return { scenarioId, anchor: group?.anchor ?? { x: 0, y: 0 } };
    });

    for (let firstIndex = 0; firstIndex < anchors.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < anchors.length; secondIndex += 1) {
        const first = anchors[firstIndex];
        const second = anchors[secondIndex];
      const apart = Math.hypot(
        (first?.anchor.x ?? 0) - (second?.anchor.x ?? 0),
        (first?.anchor.y ?? 0) - (second?.anchor.y ?? 0),
      );
      expect(apart, `${first?.scenarioId} and ${second?.scenarioId} deploy alike`).toBeGreaterThan(
        400,
      );
      }
    }
  });

  it('strands the King on the far shore in the operation that is about that', () => {
    // The Salt Tide is the one operation whose whole shape is in its
    // deployment: the sovereign starts on the enemy's side of the water.
    const state = new SimulationEngine({ scenarioId: 'salt_tide' }).getState();
    useBattleMap(state.mapId);
    const king = state.objective.kings.player;

    expect(king.position.y).toBeLessThan(barrierCenterAt(king.position.x));
    const rest = activeGroups(state, 'player').filter(
      (group) => group.id !== king.guardGroupId && group.id !== 'ironbacks',
    );
    for (const group of rest) {
      expect(group.anchor.y, `${group.id} should be on the near shore`).toBeGreaterThan(
        barrierCenterAt(group.anchor.x),
      );
    }
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
        const group = state.groups[state.groupIndexById.get('cinder_host') ?? -1];
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
        groupIds: ['greyriders'],
        order: 'attack_zone',
        targetZone: 'west_crossing',
      });
      run(engine, 200);
      engine.dispatch('human', {
        type: 'change_formation',
        playerId: 'player',
        groupIds: ['vanguard'],
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
  it('keeps a regiment under orders until only its emergency remnant remains', async () => {
    const engine = new SimulationEngine({ difficultyId: 'warlord' });
    const state = engine.getState();

    const legion = (): (typeof state.groups)[number] | undefined =>
      state.groups[state.groupIndexById.get('vanguard') ?? -1];

    const initial = legion()?.initialStrength ?? 0;
    expect(initial).toBeGreaterThan(300);

    engine.dispatch('human', {
      type: 'order_groups',
      playerId: 'player',
      groupIds: ['vanguard'],
      order: 'attack_zone',
      targetZone: 'central_field',
    });

    let brokeAt = -1;
    let lastStrength = 1;
    for (let tick = 0; tick < TICKS_PER_SECOND * 60 * 8; tick += 1) {
      await breathe(tick);
      engine.step();
      const group = legion();
      if (group === undefined || group.members.length === 0) break;
      lastStrength = group.members.length / initial;
      if (group.routing) {
        brokeAt = lastStrength;
        break;
      }
    }

    expect(brokeAt < 0 || brokeAt < 0.1).toBe(true);
  });

  it('will not let a shattered regiment recover full confidence', async () => {
    const engine = new SimulationEngine({ scenarioId: 'bridge_of_knives' });
    const state = engine.getState();
    const group = state.groups[state.groupIndexById.get('greyriders') ?? -1];
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
      [20, ['vanguard', 'ironbacks', 'longbows', 'vale_bowmen'], 'central_field'],
      [120, ['vanguard', 'ironbacks'], 'central_bridge'],
      [300, ['vanguard', 'ironbacks', 'kingsguard'], 'enemy_base'],
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
    // Twenty-five battle-minutes of simulation for two armies of four thousand
    // is well past what the default per-test budget allows, and the battle
    // itself now runs longer than it did: guns, shot and surgeons all lengthen
    // an engagement, which is the point of them.
  }, 600_000);

  it('commits the enemy against the player king once the escalation is spent', async () => {
    const engine = new SimulationEngine({ difficultyId: 'warlord' });
    const state = engine.getState();

    // Well past the warlord final-push threshold.
    for (let tick = 0; tick < TICKS_PER_SECOND * 300; tick += 1) {
      await breathe(tick);
      engine.step();
    }

    const kingZone = state.groups[state.groupIndexById.get('kingsguard') ?? -1];
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
    const engine = new SimulationEngine({
      scenarioId: 'custom',
      scenario: FULL_VALE,
      difficultyId: 'captain',
    });
    const state = engine.getState();

    const committed = activeGroups(state, 'player')
      .filter((group) => group.id !== 'kingsguard')
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
