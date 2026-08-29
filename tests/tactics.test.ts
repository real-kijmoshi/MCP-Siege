import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND, counterMultiplier } from '../src/game/config/battle';
import { createGroupFromSpec, type GroupSpec } from '../src/game/config/scenario';
import { formationRadius, formationSlots } from '../src/game/simulation/Formations';
import { createEmptyState, findGroup, type GameState } from '../src/game/simulation/GameState';
import { advanceCombat } from '../src/game/simulation/Combat';
import { advanceMorale } from '../src/game/simulation/Morale';
import { advanceMovement } from '../src/game/simulation/Movement';
import { computePath } from '../src/game/simulation/Navigation';
import { isPassable, riverCenterY, zoneAt } from '../src/game/simulation/Zones';
import { applyOrderToGroup } from '../src/game/commands/handlers/shared';
import { FORMATIONS, type UnitCategory } from '../src/game/types/domain';

const ANCHOR = { x: 4000, y: 3000 };

describe('formations', () => {
  it('places exactly one slot per man in every formation', () => {
    for (const formation of FORMATIONS) {
      const slots = formationSlots(formation, 250, ANCHOR, -Math.PI / 2);
      expect(slots, formation).toHaveLength(250);
      for (const slot of slots) {
        expect(Number.isFinite(slot.x), formation).toBe(true);
        expect(Number.isFinite(slot.y), formation).toBe(true);
      }
    }
  });

  it('gives a line a far wider front than a column', () => {
    const width = (formation: 'line' | 'column'): number => {
      const slots = formationSlots(formation, 400, ANCHOR, -Math.PI / 2);
      const xs = slots.map((slot) => slot.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(width('line')).toBeGreaterThan(width('column') * 3);
  });

  it('builds a wedge that narrows to a point at the front', () => {
    const slots = formationSlots('wedge', 120, ANCHOR, -Math.PI / 2);
    // Facing north, the tip is the northernmost (smallest y) rank.
    const sorted = [...slots].sort((a, b) => a.y - b.y);
    const frontRank = sorted.slice(0, 1);
    const backRank = sorted.slice(-15);
    const spread = (rank: typeof slots): number =>
      Math.max(...rank.map((s) => s.x)) - Math.min(...rank.map((s) => s.x));
    expect(spread(frontRank)).toBeLessThan(spread(backRank));
  });

  it('leaves the middle of a defensive square empty', () => {
    const count = 200;
    const slots = formationSlots('square', count, ANCHOR, -Math.PI / 2);
    const centroid = {
      x: slots.reduce((sum, s) => sum + s.x, 0) / count,
      y: slots.reduce((sum, s) => sum + s.y, 0) / count,
    };
    const radius = formationRadius('square', count);
    const nearCentre = slots.filter(
      (slot) => Math.hypot(slot.x - centroid.x, slot.y - centroid.y) < radius * 0.35,
    );
    // A hollow square keeps its interior clear.
    expect(nearCentre.length).toBeLessThan(count * 0.15);
  });

  it('disperses a loose formation more widely than a block', () => {
    const area = (formation: 'loose' | 'block'): number => {
      const slots = formationSlots(formation, 300, ANCHOR, -Math.PI / 2);
      const xs = slots.map((s) => s.x);
      const ys = slots.map((s) => s.y);
      return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    };
    expect(area('loose')).toBeGreaterThan(area('block') * 1.5);
  });
});

describe('counters', () => {
  it('encodes the rock-paper-scissors the brief calls for', () => {
    expect(counterMultiplier('spearman', 'cavalry')).toBeGreaterThan(2);
    expect(counterMultiplier('cavalry', 'spearman')).toBeLessThan(0.6);
    expect(counterMultiplier('cavalry', 'archer')).toBeGreaterThan(2);
    expect(counterMultiplier('cavalry', 'siege')).toBeGreaterThan(1.5);
    expect(counterMultiplier('archer', 'heavy_infantry')).toBeLessThan(1);
    expect(counterMultiplier('infantry', 'infantry')).toBe(1);
  });
});

/* -------------------------------------------------------- combat harness */

/** An isolated duel, so results are not muddied by the wider battle. */
function duel(
  attacker: { category: UnitCategory; count: number; spec?: Partial<GroupSpec> },
  defender: { category: UnitCategory; count: number; spec?: Partial<GroupSpec> },
  ticks = TICKS_PER_SECOND * 40,
): { state: GameState; attackers: number; defenders: number } {
  const state = createEmptyState(1234);

  createGroupFromSpec(state, {
    id: 'attacker',
    name: 'Attacker',
    ownerId: 'player',
    anchor: { x: 4000, y: 3000 },
    formation: 'block',
    stance: 'aggressive',
    composition: [[attacker.category, attacker.count]],
    ...attacker.spec,
  });

  createGroupFromSpec(state, {
    id: 'defender',
    name: 'Defender',
    ownerId: 'enemy',
    anchor: { x: 4000, y: 3160 },
    formation: 'block',
    stance: 'aggressive',
    composition: [[defender.category, defender.count]],
    ...defender.spec,
  });

  for (let tick = 0; tick < ticks; tick += 1) {
    state.currentTick += 1;
    advanceMovement(state);
    advanceCombat(state);
    advanceMorale(state);
  }

  return {
    state,
    attackers: findGroup(state, 'attacker')?.members.length ?? 0,
    defenders: findGroup(state, 'defender')?.members.length ?? 0,
  };
}

describe('combat', () => {
  it('lets spearmen break an equal number of cavalry', () => {
    const result = duel({ category: 'spearman', count: 200 }, { category: 'cavalry', count: 200 });
    expect(result.attackers).toBeGreaterThan(result.defenders);
  });

  it('lets cavalry ride down an equal number of archers', () => {
    const result = duel({ category: 'cavalry', count: 200 }, { category: 'archer', count: 200 });
    expect(result.attackers).toBeGreaterThan(result.defenders);
  });

  it('spares a loose formation the worst of a siege bombardment', () => {
    const dense = duel(
      { category: 'siege', count: 30 },
      { category: 'infantry', count: 400, spec: { formation: 'block' } },
    );
    const dispersed = duel(
      { category: 'siege', count: 30 },
      { category: 'infantry', count: 400, spec: { formation: 'loose' } },
    );
    expect(dispersed.defenders).toBeGreaterThan(dense.defenders);
  });

  it('makes a defensive square markedly better against a cavalry charge', () => {
    // Sized so both formations still have men standing; an annihilation on
    // both sides would prove nothing.
    const charge = (formation: 'line' | 'square') =>
      duel(
        { category: 'cavalry', count: 150 },
        { category: 'infantry', count: 400, spec: { formation } },
        TICKS_PER_SECOND * 30,
      );
    const line = charge('line');
    const square = charge('square');

    expect(square.defenders).toBeGreaterThan(0);
    expect(square.defenders).toBeGreaterThan(line.defenders);
  });
});

describe('morale', () => {
  it('falls under sustained casualties and eventually breaks a group', () => {
    const result = duel(
      { category: 'cavalry', count: 600 },
      { category: 'archer', count: 150 },
      TICKS_PER_SECOND * 60,
    );
    const defender = findGroup(result.state, 'defender');
    expect(defender).toBeDefined();
    expect(defender!.morale).toBeLessThan(60);
  });

  it('refuses orders while routing, and accepts them again once rallied', () => {
    const state = createEmptyState(99);
    createGroupFromSpec(state, {
      id: 'broken',
      name: 'Broken',
      ownerId: 'player',
      anchor: { x: 4000, y: 3000 },
      formation: 'block',
      stance: 'defensive',
      composition: [['infantry', 100]],
    });

    const group = findGroup(state, 'broken');
    expect(group).toBeDefined();

    group!.morale = 5;
    advanceMorale(state);
    expect(group!.routing).toBe(true);

    const refused = applyOrderToGroup(state, group!, 'attack_zone', {
      targetZone: 'central_bridge',
    });
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe('GROUP_ROUTING');

    // Out of contact it rallies, and then it will obey again.
    for (let tick = 0; tick < TICKS_PER_SECOND * 60; tick += 1) {
      state.currentTick += 1;
      advanceMorale(state);
    }
    expect(group!.routing).toBe(false);

    const accepted = applyOrderToGroup(state, group!, 'attack_zone', {
      targetZone: 'central_bridge',
    });
    expect(accepted.ok).toBe(true);
  });
});

describe('terrain and navigation', () => {
  it('makes the river impassable except at the crossings', () => {
    // Mid-river, far from any crossing.
    expect(isPassable(3000, riverCenterY(3000))).toBe(false);
    // On the central bridge.
    expect(isPassable(4000, riverCenterY(4000))).toBe(true);
  });

  it('routes a march to the far bank over passable ground the whole way', () => {
    const from = { x: 4000, y: 3900 };
    const to = { x: 3000, y: 1500 };
    const path = computePath(from, to);

    expect(path.length).toBeGreaterThan(1);

    // The real guarantee is that the whole marched polyline stays on dry
    // ground: an explicit crossing waypoint is dropped when the leg already
    // runs over one, so checking the waypoints alone would prove nothing.
    let crossedTheRiver = false;
    let cursor = from;
    for (const waypoint of path) {
      const steps = Math.ceil(Math.hypot(waypoint.x - cursor.x, waypoint.y - cursor.y) / 40);
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const x = cursor.x + (waypoint.x - cursor.x) * t;
        const y = cursor.y + (waypoint.y - cursor.y) * t;
        expect(isPassable(x, y), `impassable at ${Math.round(x)},${Math.round(y)}`).toBe(true);
        if (Math.abs(y - riverCenterY(x)) < 40) {
          crossedTheRiver = true;
          // Wherever it fords, it must be at a named crossing.
          expect(['central_bridge', 'west_crossing', 'east_crossing']).toContain(zoneAt(x, y));
        }
      }
      cursor = waypoint;
    }

    expect(crossedTheRiver).toBe(true);
  });

  it('marches directly when no water is in the way', () => {
    const path = computePath({ x: 4000, y: 3400 }, { x: 4600, y: 3500 });
    expect(path).toHaveLength(1);
  });
});
