import { describe, expect, it, vi } from 'vitest';
import {
  COUNTER_MATRIX,
  FORMATION_PROFILES,
  STANCE_PROFILES,
  TICKS_PER_SECOND,
  counterMultiplier,
} from '../src/game/config/battle';
import { SCENARIOS, createGroupFromSpec } from '../src/game/config/scenario';
import { UNIT_STATS, terrainDefenceModifier } from '../src/game/config/battle';
import { advanceCombat } from '../src/game/simulation/Combat';
import { advanceMorale } from '../src/game/simulation/Morale';
import { advanceMovement } from '../src/game/simulation/Movement';
import { SimulationEngine } from '../src/game/simulation/Engine';
import { createEmptyState, findGroup, type GameState } from '../src/game/simulation/GameState';
import { useBattleMap } from '../src/game/simulation/Zones';
import { GameQueries } from '../src/game/queries/GameQueries';
import { createWebMcpToolHandlers, type WebMcpToolHandlers } from '../src/integrations/webmcp/tools';
import { FORMATIONS, UNIT_CATEGORIES, type UnitCategory, type ZoneId } from '../src/game/types/domain';

/**
 * The Marshal's own instruments.
 *
 * These four tools exist so an external commander can reason about this
 * battlefield rather than a remembered one: what the rules actually are, what a
 * fight would cost before it is ordered, when troops would arrive, and what
 * happened while it was thinking. The tests hold them to that — that the
 * doctrine cannot drift from the tuning, that the assessment prices the
 * mistakes the model punishes, that a march is timed over the ground it
 * crosses, and that a wait is measured in battle time and never resolves on
 * something the fog hides.
 */

function unwrap(result: unknown): Record<string, unknown> {
  const envelope = result as { success: boolean; data?: unknown; error?: unknown };
  expect(envelope.success, JSON.stringify(envelope.error)).toBe(true);
  return envelope.data as Record<string, unknown>;
}

function failure(result: unknown): { code: string; message: string; suggestions: string[] } {
  const envelope = result as {
    success: boolean;
    error: { code: string; message: string; suggestions: string[] };
  };
  expect(envelope.success).toBe(false);
  return envelope.error;
}

/* ---------------------------------------------------------------- doctrine */

describe('doctrine', () => {
  const queries = new GameQueries(() => createEmptyState(1, SCENARIOS.bridge_of_knives));

  it('reports the counter table the simulation actually runs', () => {
    const doctrine = queries.getDoctrine();
    for (const arm of doctrine.arms) {
      for (const entry of arm.strongAgainst) {
        expect(entry.multiplier, `${arm.category} vs ${entry.category}`).toBe(
          counterMultiplier(arm.category, entry.category),
        );
      }
      for (const entry of arm.vulnerableTo) {
        expect(entry.multiplier, `${entry.category} vs ${arm.category}`).toBe(
          counterMultiplier(entry.category, arm.category),
        );
      }
    }
  });

  it('names every matchup the table calls decisive, and invents none', () => {
    const doctrine = queries.getDoctrine();
    for (const category of UNIT_CATEGORIES) {
      const arm = doctrine.arms.find((entry) => entry.category === category);
      expect(arm, category).toBeDefined();
      const named = new Set(arm?.strongAgainst.map((entry) => entry.category));
      for (const [defender, multiplier] of Object.entries(COUNTER_MATRIX[category])) {
        if ((multiplier ?? 1) >= 1.2) expect(named, `${category} vs ${defender}`).toContain(defender);
      }
    }
    // The one every agent gets wrong from memory: horse do not break spears.
    const horse = doctrine.arms.find((arm) => arm.category === 'cavalry');
    expect(horse?.vulnerableTo.map((entry) => entry.category)).toContain('spearman');
    expect(horse?.strongAgainst.map((entry) => entry.category)).not.toContain('spearman');
  });

  it('cannot drift from the formation and stance tuning', () => {
    const doctrine = queries.getDoctrine();
    for (const formation of FORMATIONS) {
      const entry = doctrine.formations.find((line) => line.formation === formation);
      expect(entry?.melee, formation).toBe(FORMATION_PROFILES[formation].meleeModifier);
      expect(entry?.ranged, formation).toBe(FORMATION_PROFILES[formation].rangedModifier);
      expect(entry?.antiCavalry, formation).toBe(FORMATION_PROFILES[formation].antiCavalry);
    }
    for (const stance of doctrine.stances) {
      expect(stance.damage).toBe(STANCE_PROFILES[stance.stance].damageModifier);
      expect(stance.damageTaken).toBe(STANCE_PROFILES[stance.stance].damageTakenModifier);
    }
  });

  it('tells a gun crew what nothing else on the field would', () => {
    const doctrine = queries.getDoctrine();
    const cannon = doctrine.arms.find((arm) => arm.category === 'cannon');
    expect(cannon?.notes.join(' ')).toContain('stand still');
    expect(cannon?.notes.join(' ')).toContain('holds its fire');
    const engine = doctrine.arms.find((arm) => arm.category === 'siege');
    expect(engine?.notes.join(' ')).toContain('over a friendly line');
  });

  it('reads the ground out of the same table the damage function does', () => {
    const doctrine = queries.getDoctrine();
    for (const ground of doctrine.terrain) {
      expect(ground.meleeDamageTaken, ground.terrain).toBe(
        terrainDefenceModifier(ground.terrain, false),
      );
      expect(ground.missileDamageTaken, ground.terrain).toBe(
        terrainDefenceModifier(ground.terrain, true),
      );
    }
    const forest = doctrine.terrain.find((ground) => ground.terrain === 'forest');
    expect(forest?.missileDamageTaken).toBeLessThan(forest?.meleeDamageTaken ?? 0);
    expect(doctrine.terrain.find((ground) => ground.terrain === 'open')?.meleeDamageTaken).toBe(1);
  });

  it('returns only the sections asked for', () => {
    const tools = handlersFor(new SimulationEngine(3));
    const data = unwrap(tools.getDoctrine({ sections: ['mechanics'] }));
    expect(data.mechanics).toBeTruthy();
    expect(data.arms).toBeUndefined();
    expect(data.formations).toBeUndefined();
    const codes = (data.mechanics as Array<{ id: string }>).map((entry) => entry.id);
    expect(codes).toContain('line_of_fire');
    expect(codes).toContain('encirclement');
  });
});

/* -------------------------------------------------------------- assessment */

/** A battle stripped to the regiments a test cares about. */
function field(
  groups: Array<{
    id: string;
    owner: 'player' | 'enemy';
    at: { x: number; y: number };
    composition: ReadonlyArray<readonly [UnitCategory, number]>;
    formation?: 'line' | 'block' | 'square' | 'column';
  }>,
): GameState {
  // `createEmptyState` builds the ground and nothing on it, so what follows is
  // the whole order of battle: no other regiment can muddy the reading.
  const state = createEmptyState(99, SCENARIOS.bridge_of_knives);
  useBattleMap(state.mapId);
  for (const spec of groups) {
    createGroupFromSpec(state, {
      id: spec.id,
      name: spec.id,
      ownerId: spec.owner,
      anchor: spec.at,
      formation: spec.formation ?? 'block',
      stance: 'defensive',
      composition: spec.composition,
    });
  }
  return state;
}

/** Puts an enemy regiment into the player's intelligence, as sighting would. */
function sight(state: GameState, groupId: string, zone: ZoneId, at: { x: number; y: number }): void {
  const group = findGroup(state, groupId);
  const categories = new Set<UnitCategory>();
  for (const index of group?.members ?? []) categories.add(state.units.categoryOf(index));
  state.contacts.player.set(groupId, {
    groupId,
    name: groupId,
    estimatedStrength: group?.members.length ?? 0,
    composition: [...categories].sort(),
    lastPosition: at,
    lastSeenTick: state.currentTick,
    lastSeenZone: zone,
    visibleNow: true,
  });
}

describe('assess_engagement', () => {
  it('prices the mistake every commander makes from memory', () => {
    const state = field([
      { id: 'horse', owner: 'player', at: { x: 4000, y: 3300 }, composition: [['cavalry', 200]] },
      { id: 'foot', owner: 'player', at: { x: 4100, y: 3300 }, composition: [['infantry', 200]] },
      { id: 'hedge', owner: 'enemy', at: { x: 4000, y: 3200 }, composition: [['spearman', 200]] },
    ]);
    sight(state, 'hedge', 'central_field', { x: 4000, y: 3200 });
    const queries = new GameQueries(() => state);

    const cavalry = queries.assessEngagement('player', { groupIds: ['horse'], targetGroupId: 'hedge' });
    const infantry = queries.assessEngagement('player', { groupIds: ['foot'], targetGroupId: 'hedge' });

    // Two hundred horse are worth less against a spear hedge than two hundred foot.
    expect(cavalry.advantage).toBeLessThan(infantry.advantage);
    expect(cavalry.verdict === 'losing' || cavalry.verdict === 'costly').toBe(true);
    expect(cavalry.recommendations.join(' ')).toContain('Do not put your horse into their spears');
    expect(cavalry.matchups.some((entry) => entry.theirs === 'spearman')).toBe(true);
  });

  it('makes ground worth what the simulation pays for it', () => {
    const build = (zone: ZoneId, at: { x: number; y: number }) => {
      const state = field([
        { id: 'foot', owner: 'player', at: { x: at.x, y: at.y + 200 }, composition: [['infantry', 300]] },
        { id: 'holders', owner: 'enemy', at, composition: [['infantry', 300]] },
      ]);
      sight(state, 'holders', zone, at);
      return new GameQueries(() => state).assessEngagement('player', {
        groupIds: ['foot'],
        targetGroupId: 'holders',
      });
    };

    const open = build('central_field', { x: 4000, y: 3200 });
    const hill = build('central_hill', { x: 4950, y: 3050 });
    expect(hill.advantage).toBeLessThan(open.advantage);
    expect(hill.recommendations.join(' ')).toContain('hill');
    expect(hill.target.terrain).toBe('hill');
  });

  it('counts a masked battery as the nothing it is contributing', () => {
    const state = field([
      { id: 'guns', owner: 'player', at: { x: 4000, y: 3300 }, composition: [['cannon', 40]] },
      { id: 'target', owner: 'enemy', at: { x: 4000, y: 3200 }, composition: [['infantry', 300]] },
    ]);
    sight(state, 'target', 'central_field', { x: 4000, y: 3200 });
    const queries = new GameQueries(() => state);

    const clear = queries.assessEngagement('player', { groupIds: ['guns'], targetGroupId: 'target' });
    expect(clear.yourDamagePerSecond).toBeGreaterThan(0);

    findGroup(state, 'guns')!.blockedFire = 0.6;
    const masked = queries.assessEngagement('player', { groupIds: ['guns'], targetGroupId: 'target' });
    expect(masked.yourDamagePerSecond).toBe(0);
    expect(masked.attackers[0]?.warnings.join(' ')).toContain('masked');
  });

  it('prices the enemy from intelligence rather than from the truth', () => {
    const state = field([
      { id: 'foot', owner: 'player', at: { x: 4000, y: 3300 }, composition: [['infantry', 300]] },
      { id: 'hidden', owner: 'enemy', at: { x: 4000, y: 3200 }, composition: [['infantry', 900]] },
    ]);
    // Seen once, at half its real weight, and it has been reinforced since.
    state.contacts.player.set('hidden', {
      groupId: 'hidden',
      name: 'hidden',
      estimatedStrength: 450,
      composition: ['infantry'],
      lastPosition: { x: 4000, y: 3200 },
      lastSeenTick: 0,
      lastSeenZone: 'central_field',
      visibleNow: false,
    });
    state.currentTick = TICKS_PER_SECOND * 30;

    const report = new GameQueries(() => state).assessEngagement('player', {
      groupIds: ['foot'],
      targetGroupId: 'hidden',
    });
    expect(report.target.estimatedStrength).toBe(450);
    expect(report.target.visibleNow).toBe(false);
    expect(report.target.lastSeenSecondsAgo).toBe(30);
    expect(report.assumptions.join(' ')).toContain('rounded estimate');
  });

  it('refuses ground where nothing has been seen, and says to scout it', () => {
    const state = field([
      { id: 'foot', owner: 'player', at: { x: 4000, y: 3300 }, composition: [['infantry', 100]] },
    ]);
    const queries = new GameQueries(() => state);
    expect(() =>
      queries.assessEngagement('player', { groupIds: ['foot'], targetZone: 'east_forest' }),
    ).toThrowError(/No enemy force is known/);

    try {
      queries.assessEngagement('player', { groupIds: ['foot'], targetZone: 'east_forest' });
    } catch (error) {
      const suggestions = (error as { suggestions: string[] }).suggestions.join(' ');
      // It must never read as "that ground is empty".
      expect(suggestions).toContain('Scout it first');
      expect(suggestions).toContain('absence of intelligence');
    }
  });
});

/* --------------------------------------- the assessment against the truth */

/**
 * The assessment is only worth calling if it agrees with the battle.
 *
 * Each of these fights is both projected and then actually fought in the
 * simulation, and the projection has to come out on the same side of the
 * result. It is the test that caught the model this tool was first built on:
 * summing whole regiments called eight hundred foot against three hundred and
 * twenty-five armoured men decisive, and the simulation destroys the eight
 * hundred. Only the men on the front fight, and that is now what is counted.
 */
function fight(
  ours: readonly [UnitCategory, number],
  theirs: readonly [UnitCategory, number],
  seconds = 60,
): { predicted: number; actual: number; verdict: string; ourLoss: number; theirLoss: number } {
  const state = createEmptyState(1234, SCENARIOS.bridge_of_knives);
  useBattleMap(state.mapId);
  createGroupFromSpec(state, {
    id: 'ours',
    name: 'ours',
    ownerId: 'player',
    anchor: { x: 4000, y: 3260 },
    formation: 'block',
    stance: 'aggressive',
    composition: [ours],
  });
  createGroupFromSpec(state, {
    id: 'theirs',
    name: 'theirs',
    ownerId: 'enemy',
    anchor: { x: 4000, y: 3200 },
    formation: 'block',
    stance: 'aggressive',
    composition: [theirs],
  });
  sight(state, 'theirs', 'central_field', { x: 4000, y: 3200 });

  const report = new GameQueries(() => state).assessEngagement('player', {
    groupIds: ['ours'],
    targetGroupId: 'theirs',
  });

  for (let tick = 0; tick < seconds * TICKS_PER_SECOND; tick += 1) {
    state.currentTick += 1;
    advanceMovement(state);
    advanceCombat(state);
    advanceMorale(state);
  }

  const ourLoss = (ours[1] - (findGroup(state, 'ours')?.members.length ?? 0)) / ours[1];
  const theirLoss = (theirs[1] - (findGroup(state, 'theirs')?.members.length ?? 0)) / theirs[1];
  return {
    predicted: report.advantage,
    // How much worse they came off than we did. Above 1 means we won it.
    actual: theirLoss / Math.max(0.0001, ourLoss),
    verdict: report.verdict,
    ourLoss,
    theirLoss,
  };
}

describe('assess_engagement against the simulation', () => {
  const decisive: Array<[readonly [UnitCategory, number], readonly [UnitCategory, number]]> = [
    [['cavalry', 200], ['spearman', 200]],
    [['infantry', 800], ['heavy_infantry', 325]],
    [['archer', 300], ['infantry', 300]],
    [['archer', 100], ['infantry', 300]],
    [['handgunner', 100], ['infantry', 300]],
    [['spearman', 200], ['cavalry', 200]],
  ];

  for (const [ours, theirs] of decisive) {
    it(`calls ${ours[0]}x${ours[1]} against ${theirs[0]}x${theirs[1]} the way the battle does`, () => {
      const result = fight(ours, theirs);
      // Only fights the simulation itself decides are asserted on.
      expect(Math.abs(Math.log(result.actual)), 'the duel was too close to judge').toBeGreaterThan(
        Math.log(1.3),
      );
      expect(
        Math.sign(Math.log(result.predicted)),
        `predicted ${result.predicted} (${result.verdict}), actual ${result.actual.toFixed(2)}`,
      ).toBe(Math.sign(Math.log(result.actual)));
    });
  }

  it('projects an even melee within a factor of two of the casualties it produces', () => {
    for (const strength of [50, 100, 300, 600]) {
      const state = createEmptyState(1234, SCENARIOS.bridge_of_knives);
      useBattleMap(state.mapId);
      createGroupFromSpec(state, {
        id: 'ours',
        name: 'ours',
        ownerId: 'player',
        anchor: { x: 4000, y: 3260 },
        formation: 'block',
        stance: 'aggressive',
        composition: [['infantry', strength]],
      });
      createGroupFromSpec(state, {
        id: 'theirs',
        name: 'theirs',
        ownerId: 'enemy',
        anchor: { x: 4000, y: 3200 },
        formation: 'block',
        stance: 'aggressive',
        composition: [['infantry', strength]],
      });
      sight(state, 'theirs', 'central_field', { x: 4000, y: 3200 });

      const report = new GameQueries(() => state).assessEngagement('player', {
        groupIds: ['ours'],
        targetGroupId: 'theirs',
      });
      const predicted = (report.yourDamagePerSecond / UNIT_STATS.infantry.maxHitPoints) * 60;

      for (let tick = 0; tick < 60 * TICKS_PER_SECOND; tick += 1) {
        state.currentTick += 1;
        advanceMovement(state);
        advanceCombat(state);
        advanceMorale(state);
      }
      const actual = strength - (findGroup(state, 'theirs')?.members.length ?? 0);

      expect(predicted, `${strength} a side`).toBeGreaterThan(actual * 0.5);
      expect(predicted, `${strength} a side`).toBeLessThan(actual * 2);
    }
  });

  it('never lets a big battalion read as a decisive one', () => {
    // Eight hundred foot cannot bring their numbers to bear on a front three
    // hundred and twenty-five men wide, which is the whole reason they lose it.
    const result = fight(['infantry', 800], ['heavy_infantry', 325]);
    expect(result.verdict).not.toBe('decisive');
    expect(result.verdict).not.toBe('favourable');
    expect(result.ourLoss).toBeGreaterThan(result.theirLoss);
  });
});

/* ------------------------------------------------------------------ march */

describe('estimate_march', () => {
  it('times horse, foot and guns apart rather than together', () => {
    const state = field([
      { id: 'horse', owner: 'player', at: { x: 4000, y: 4400 }, composition: [['cavalry', 100]] },
      { id: 'foot', owner: 'player', at: { x: 4000, y: 4400 }, composition: [['infantry', 100]] },
      { id: 'guns', owner: 'player', at: { x: 4000, y: 4400 }, composition: [['cannon', 20]] },
    ]);
    const report = new GameQueries(() => state).estimateMarch(
      'player',
      ['horse', 'foot', 'guns'],
      'central_field',
    );

    const seconds = (id: string): number =>
      report.estimates.find((estimate) => estimate.groupId === id)?.seconds ?? -1;
    expect(seconds('horse')).toBeGreaterThan(0);
    expect(seconds('horse')).toBeLessThan(seconds('foot'));
    expect(seconds('foot')).toBeLessThan(seconds('guns'));
    expect(report.arrivalSpread).toBe(seconds('guns') - seconds('horse'));
    expect(report.summary).toContain('behind it');
    expect(
      report.estimates.find((estimate) => estimate.groupId === 'guns')?.warnings.join(' '),
    ).toContain('add 4s standing still');
  });

  it('prices the ground under the route, not the ground under the regiment', () => {
    // Both start on open field the same distance out; one route runs through wood.
    const state = field([
      { id: 'clear', owner: 'player', at: { x: 4000, y: 3200 }, composition: [['cannon', 20]] },
      { id: 'wooded', owner: 'player', at: { x: 2750, y: 3550 }, composition: [['cannon', 20]] },
    ]);
    const report = new GameQueries(() => state).estimateMarch('player', ['wooded'], 'west_forest');
    const wooded = report.estimates[0];
    expect(wooded?.distance).toBeGreaterThan(0);
    // A battery crawls through trees: the estimate must be far worse than the
    // same distance over open ground would give at its nominal pace.
    const openPace = 16; // paces per second on the level, from UNIT_STATS.cannon
    expect(wooded!.seconds).toBeGreaterThan((wooded!.distance / openPace) * 1.4);
    expect(wooded?.slowestArm).toBe('cannon');
  });

  it('names the crossing a route has to thread, and warns about it', () => {
    const state = field([
      { id: 'foot', owner: 'player', at: { x: 4000, y: 3400 }, composition: [['infantry', 200]] },
    ]);
    const report = new GameQueries(() => state).estimateMarch(
      'player',
      ['foot'],
      'enemy_outer_defense',
    );
    const march = report.estimates[0];
    expect(march?.usesCrossing).toBe(true);
    expect(march?.route.join(', ')).toContain('Bridge');
    expect(march?.warnings.join(' ')).toContain('column');
  });

  it('times the whole army when no groups are named', () => {
    const engine = new SimulationEngine(11);
    const queries = new GameQueries(() => engine.getState());
    const report = queries.estimateMarch('player', [], 'central_field');
    expect(report.estimates.length).toBe(queries.getArmies('player').length);
  });
});

/* ------------------------------------------------------------------ watch */

function handlersFor(engine: SimulationEngine): WebMcpToolHandlers {
  return createWebMcpToolHandlers({ engine, queries: new GameQueries(() => engine.getState()) });
}

/** Advances the battle in the background while a wait is outstanding. */
function runInBackground(engine: SimulationEngine, ticks: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = ticks;
    const pump = (): void => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      remaining -= 1;
      engine.step();
      setTimeout(pump, 0);
    };
    setTimeout(pump, 0);
  });
}

describe('watch_battle', () => {
  it('returns the moment the thing you named happens, not when a timer says so', async () => {
    const engine = new SimulationEngine(5);
    const tools = handlersFor(engine);
    const group = engine.getState().groups.find((entry) => entry.ownerId === 'player')!;

    const waiting = tools.watchBattle({
      conditions: [{ kind: 'morale_below', groupId: group.id, value: 50 }],
      timeoutSeconds: 120,
    });

    // Ten ticks of ordinary battle, then the regiment gives way.
    await runInBackground(engine, 10);
    group.morale = 20;
    await runInBackground(engine, 2);

    const data = unwrap(await waiting);
    expect(data.status).toBe('fired');
    expect(data.alreadyTrue).toBe(false);
    expect((data.fired as { kind: string }).kind).toBe('morale_below');
    expect(data.waitedSeconds as number).toBeLessThan(5);
  });

  it('reports what changed while it was waiting', async () => {
    const engine = new SimulationEngine(5);
    const tools = handlersFor(engine);
    const group = engine.getState().groups.find((entry) => entry.ownerId === 'player')!;
    const before = group.members.length;

    const waiting = tools.watchBattle({
      conditions: [{ kind: 'timer_elapsed', seconds: 2 }],
      timeoutSeconds: 60,
    });

    await runInBackground(engine, 20);
    for (let killed = 0; killed < 30; killed += 1) {
      const index = group.members[0];
      if (index !== undefined) engine.getState().units.kill(index);
      group.members.shift();
    }
    await runInBackground(engine, 25);

    const data = unwrap(await waiting);
    expect(data.status).toBe('fired');
    const changes = data.changes as { quiet: boolean; groups: Array<{ groupId: string; losses: number }>; summary: string };
    expect(changes.quiet).toBe(false);
    const line = changes.groups.find((entry) => entry.groupId === group.id);
    expect(line?.losses).toBe(before - group.members.length);
    expect(changes.summary).toContain('men lost');
  });

  it('answers at once, and says so, when the condition already holds', async () => {
    const engine = new SimulationEngine(5);
    const tools = handlersFor(engine);
    const group = engine.getState().groups.find((entry) => entry.ownerId === 'player')!;
    group.morale = 10;

    const data = unwrap(
      await tools.watchBattle({
        conditions: [{ kind: 'morale_below', groupId: group.id, value: 50 }],
        timeoutSeconds: 60,
      }),
    );
    expect(data.status).toBe('fired');
    expect(data.alreadyTrue).toBe(true);
    expect(data.waitedSeconds).toBe(0);
  });

  it('gives up after the battle time it was given, in ticks rather than milliseconds', async () => {
    const engine = new SimulationEngine(5);
    const tools = handlersFor(engine);

    const waiting = tools.watchBattle({
      conditions: [{ kind: 'king_besieged' }],
      timeoutSeconds: 2,
    });
    await runInBackground(engine, TICKS_PER_SECOND * 2 + 2);

    const data = unwrap(await waiting);
    expect(data.status).toBe('timeout');
    expect(data.waitedSeconds).toBe(2);
    expect(data.note as string).toContain('That is information');
  });

  it('reports a paused battle as paused rather than hanging on it', async () => {
    vi.useFakeTimers();
    try {
      const engine = new SimulationEngine(5);
      const tools = handlersFor(engine);
      const waiting = tools.watchBattle({
        conditions: [{ kind: 'king_besieged' }],
        timeoutSeconds: 180,
      });
      await vi.advanceTimersByTimeAsync(6000);
      const data = unwrap(await waiting);
      expect(data.status).toBe('paused');
      expect(data.note as string).toContain('paused');
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a trigger that is not something to wait for', async () => {
    const tools = handlersFor(new SimulationEngine(5));
    const error = failure(
      await tools.watchBattle({ conditions: [{ kind: 'immediate' }], timeoutSeconds: 10 }),
    );
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.message).toContain('not something to wait for');
  });

  it('never resolves on an enemy the fog is hiding', async () => {
    const engine = new SimulationEngine(5);
    const tools = handlersFor(engine);
    const queries = new GameQueries(() => engine.getState());

    // The enemy is certainly on the field; none of it has been seen yet.
    expect(queries.getVisibleEnemies('player').length).toBe(0);
    const waiting = tools.watchBattle({
      conditions: [{ kind: 'enemy_enters_zone', zoneId: 'enemy_base' }],
      timeoutSeconds: 2,
    });
    await runInBackground(engine, TICKS_PER_SECOND * 2 + 2);

    const data = unwrap(await waiting);
    expect(data.status).toBe('timeout');
  });
});
