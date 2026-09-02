import { describe, expect, it } from 'vitest';
import { OBJECTIVE, TICKS_PER_SECOND } from '../src/game/config/battle';
import { createGroupFromSpec, type GroupSpec } from '../src/game/config/scenario';
import { GameQueries } from '../src/game/queries/GameQueries';
import { evaluateCondition } from '../src/game/simulation/Conditions';
import { SimulationEngine } from '../src/game/simulation/Engine';
import { createEmptyState, findGroup, type GameState } from '../src/game/simulation/GameState';
import { advanceMorale } from '../src/game/simulation/Morale';
import { advanceObjective, livingStrengthOf } from '../src/game/simulation/Objective';
import type { UnitCategory } from '../src/game/types/domain';

/**
 * The objective.
 *
 * Two layers are tested separately on purpose. The capture contest is exercised
 * against a small hand-built state so the arithmetic is pinned exactly, and the
 * wiring — seating, riding, fog, and what happens to orders once the field is
 * decided — is exercised against the real scenario.
 */

function run(engine: SimulationEngine, ticks: number): void {
  for (let tick = 0; tick < ticks; tick += 1) engine.step();
}

/* ------------------------------------------------------------ small battles */

function spec(
  id: string,
  ownerId: 'player' | 'enemy',
  x: number,
  y: number,
  composition: ReadonlyArray<readonly [UnitCategory, number]>,
): GroupSpec {
  return {
    id,
    name: id,
    ownerId,
    anchor: { x, y },
    formation: 'block',
    stance: 'hold_ground',
    composition,
  };
}

/**
 * An enemy king at a known point with a guard of the given size, and a player
 * raiding party standing on him. Nothing else exists, so the only thing moving
 * the capture bar is the contest itself.
 */
function siegeState(guardSize: number, raiderSize: number): GameState {
  const state = createEmptyState(11);
  const kingAt = { x: 4000, y: 700 };

  if (guardSize > 0) {
    createGroupFromSpec(state, spec('guard', 'enemy', kingAt.x, kingAt.y, [['heavy_infantry', guardSize]]));
  } else {
    // A guard slot must still exist for the king to reference; leave it empty.
    createGroupFromSpec(state, spec('guard', 'enemy', kingAt.x, kingAt.y, [['infantry', 1]]));
    const guard = findGroup(state, 'guard');
    if (guard !== undefined) {
      for (const index of guard.members) state.units.alive[index] = 0;
      guard.members = [];
    }
  }

  if (raiderSize > 0) {
    createGroupFromSpec(state, spec('raiders', 'player', kingAt.x + 60, kingAt.y + 60, [['infantry', raiderSize]]));
  }

  state.objective.kings.enemy = {
    ownerId: 'enemy',
    name: 'The Ashen King',
    position: { ...kingAt },
    guardGroupId: 'guard',
    guardStrength: guardSize,
    captureProgress: 0,
    captured: false,
    besieged: false,
    defenders: guardSize,
    attackers: 0,
  };
  state.objective.kings.player.position = { x: 4000, y: 4600 };
  state.objective.initialStrength = { player: raiderSize, enemy: Math.max(1, guardSize) };
  return state;
}

function advance(state: GameState, ticks: number): void {
  for (let tick = 0; tick < ticks; tick += 1) {
    state.currentTick += 1;
    advanceObjective(state);
  }
}

describe('capturing a king', () => {
  it('takes an unguarded king and decides the battle', () => {
    const state = siegeState(0, 400);

    advance(state, OBJECTIVE.interval * 4);
    const early = state.objective.kings.enemy.captureProgress;
    expect(state.objective.kings.enemy.besieged).toBe(true);
    expect(early).toBeGreaterThan(0);

    // Long enough to fill the bar at the capped rate, not a moment more.
    advance(state, TICKS_PER_SECOND * 60);
    expect(state.objective.kings.enemy.captured).toBe(true);
    expect(state.objective.outcome).toBe('player_victory');
    expect(state.objective.outcomeReason).toContain('Ashen King');
  });

  it('refuses to start on a force too small to be an assault', () => {
    // Below `minimumAssault`, so a lone patrol wandering past changes nothing.
    const state = siegeState(0, 40);
    advance(state, TICKS_PER_SECOND * 30);

    expect(state.objective.kings.enemy.besieged).toBe(false);
    expect(state.objective.kings.enemy.captureProgress).toBe(0);
    expect(state.objective.outcome).toBe('ongoing');
  });

  it('holds the king while his guard still outweighs the attackers', () => {
    // 300 heavy infantry are worth 540; 400 infantry are worth 400.
    const state = siegeState(300, 400);
    advance(state, TICKS_PER_SECOND * 30);

    expect(state.objective.kings.enemy.besieged).toBe(false);
    expect(state.objective.kings.enemy.captureProgress).toBe(0);
  });

  it('recovers once the ring is relieved', () => {
    const state = siegeState(0, 400);
    advance(state, OBJECTIVE.interval * 10);
    const peak = state.objective.kings.enemy.captureProgress;
    expect(peak).toBeGreaterThan(0);

    // The raiders are cut down; nobody is left standing over him.
    const raiders = findGroup(state, 'raiders');
    if (raiders !== undefined) {
      for (const index of raiders.members) state.units.alive[index] = 0;
      raiders.members = [];
    }

    advance(state, OBJECTIVE.interval * 6);
    expect(state.objective.kings.enemy.captureProgress).toBeLessThan(peak);
    expect(state.objective.kings.enemy.besieged).toBe(false);
  });

  it('never takes a king faster than the rate cap allows', () => {
    // Twenty times the strength needed still cannot carry him off instantly.
    const state = siegeState(0, 4000);
    advance(state, OBJECTIVE.interval * 3);

    const perInterval = state.objective.kings.enemy.captureProgress / 3;
    expect(perInterval).toBeLessThanOrEqual(
      OBJECTIVE.progressPerInterval * OBJECTIVE.maximumRate + 0.001,
    );
  });
});

describe('the king and morale', () => {
  it('drags the whole army down while its king is beset', () => {
    const besieged = siegeState(0, 400);
    const calm = siegeState(0, 400);
    calm.objective.kings.enemy.besieged = false;

    // A distant enemy regiment, far from any fighting of its own.
    for (const state of [besieged, calm]) {
      createGroupFromSpec(state, spec('watchers', 'enemy', 4000, 2400, [['infantry', 200]]));
      const group = findGroup(state, 'watchers');
      if (group !== undefined) group.morale = 80;
    }

    advance(besieged, OBJECTIVE.interval * 2);
    expect(besieged.objective.kings.enemy.besieged).toBe(true);
    calm.objective.kings.enemy.besieged = false;

    for (let tick = 0; tick < 200; tick += 1) {
      advanceMorale(besieged);
      advanceMorale(calm);
    }

    const under = findGroup(besieged, 'watchers')?.morale ?? 0;
    const safe = findGroup(calm, 'watchers')?.morale ?? 0;
    expect(under).toBeLessThan(safe);
  });

  it('arms a conditional order on the king coming under threat', () => {
    const state = siegeState(0, 400);
    const condition = { kind: 'king_besieged' } as const;

    expect(evaluateCondition(state, 'enemy', condition, 0)).toBe(false);
    advance(state, OBJECTIVE.interval * 2);
    expect(evaluateCondition(state, 'enemy', condition, 0)).toBe(true);
    // It is the *enemy's* king under threat; the player's own is untouched.
    expect(evaluateCondition(state, 'player', condition, 0)).toBe(false);
  });
});

/* --------------------------------------------------------- the real battle */

describe('the objective in the scenario', () => {
  it('seats both kings with their guards and opens undecided', () => {
    const engine = new SimulationEngine();
    const state = engine.getState();

    expect(state.objective.outcome).toBe('ongoing');
    for (const playerId of ['player', 'enemy'] as const) {
      const king = state.objective.kings[playerId];
      const guard = findGroup(state, king.guardGroupId);
      expect(guard?.ownerId).toBe(playerId);
      expect(king.guardStrength).toBeGreaterThan(300);
      expect(king.position).toEqual({ x: guard?.anchor.x, y: guard?.anchor.y });
      expect(state.objective.initialStrength[playerId]).toBe(livingStrengthOf(state, playerId));
    }
  });

  it('rides with his guard when the guard marches', () => {
    const engine = new SimulationEngine();
    const state = engine.getState();
    const before = { ...state.objective.kings.player.position };

    engine.dispatch('human', {
      type: 'order_groups',
      playerId: 'player',
      groupIds: ['royal_guard'],
      order: 'move',
      targetZone: 'village',
    });
    run(engine, TICKS_PER_SECOND * 25);

    const guard = findGroup(state, 'royal_guard');
    const king = state.objective.kings.player;
    expect(king.position).toEqual({ x: guard?.anchor.x, y: guard?.anchor.y });
    expect(Math.hypot(king.position.x - before.x, king.position.y - before.y)).toBeGreaterThan(200);
  });

  it('does not reveal the enemy king before he has been sighted', () => {
    const engine = new SimulationEngine();
    const queries = new GameQueries(() => engine.getState());
    const report = queries.getObjective('player');

    expect(report.enemyKing.lastSeenZone).toBeUndefined();
    expect(report.enemyKing.visibleNow).toBe(false);
    expect(report.enemyKing.note).toContain('Never sighted');
    expect(report.result).toEqual({
      elapsedSeconds: 0,
      initialUnits: 4306,
      survivingUnits: 4306,
      losses: 0,
      survivingRegiments: 13,
    });

    // Nothing in the projection carries his true position, in any form.
    const trueY = engine.getState().objective.kings.enemy.position.y;
    expect(JSON.stringify(report)).not.toContain(String(Math.round(trueY)));
  });

  it('carries the objective in the overview a Marshal reads first', () => {
    const engine = new SimulationEngine();
    const queries = new GameQueries(() => engine.getState());
    const overview = queries.getBattleOverview('player');

    expect(overview.objective.outcome).toBe('ongoing');
    expect(overview.objective.goal).toContain('Ashen King');
    expect(overview.objective.yourKing).toContain('King Aldric');
    // The overview must stay small enough for an agent to read every turn.
    expect(JSON.stringify(overview).length).toBeLessThan(2000);
  });

  it('refuses orders once the field is decided', async () => {
    const engine = new SimulationEngine();
    run(engine, 10);

    // The precondition, not the thing under test: the capture path has its own
    // tests above, and marching an army to the enemy base takes minutes.
    engine.getState().objective.outcome = 'player_victory';
    engine.getState().objective.outcomeReason = 'The Ashen King has been taken.';

    const command = engine.dispatch('webmcp', {
      type: 'order_groups',
      playerId: 'player',
      groupIds: ['legion_i'],
      order: 'attack_zone',
      targetZone: 'central_bridge',
    });
    run(engine, 2);

    const result = engine.getCommandResult(command.id);
    expect(result?.ok).toBe(false);
    expect(result?.ok === false && result.code).toBe('BATTLE_OVER');

    // And the battle really has stopped: nothing manoeuvres afterwards.
    const before = findGroup(engine.getState(), 'iron_host')?.anchor.y ?? 0;
    run(engine, TICKS_PER_SECOND * 5);
    expect(findGroup(engine.getState(), 'iron_host')?.anchor.y).toBe(before);
  });
});
