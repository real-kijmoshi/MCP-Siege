import { describe, expect, it } from 'vitest';
import {
  CROWDING,
  FATIGUE,
  FORMATION_PROFILES,
  TICKS_PER_SECOND,
  UNIT_STATS,
  counterMultiplier,
} from '../src/game/config/battle';
import { createGroupFromSpec, type GroupSpec } from '../src/game/config/scenario';
import { formationRadius, formationSlots } from '../src/game/simulation/Formations';
import { createEmptyState, findGroup, type GameState } from '../src/game/simulation/GameState';
import { advanceCombat } from '../src/game/simulation/Combat';
import { advanceFatigue } from '../src/game/simulation/Fatigue';
import { advanceMorale } from '../src/game/simulation/Morale';
import { advanceMovement } from '../src/game/simulation/Movement';
import { computePath, hasClearLineOfMarch } from '../src/game/simulation/Navigation';
import { barrierCenterAt, isPassable, useBattleMap, zoneAt } from '../src/game/simulation/Zones';
import { applyOrderToGroup } from '../src/game/commands/handlers/shared';
import { FORMATIONS, type ArmyGroup, type UnitCategory } from '../src/game/types/domain';

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

  it('makes open ranks better for archers than a marching column', () => {
    expect(FORMATION_PROFILES.line.rangedModifier).toBeGreaterThan(
      FORMATION_PROFILES.column.rangedModifier * 1.4,
    );
    expect(FORMATION_PROFILES.double_line.rangedModifier).toBeGreaterThan(
      FORMATION_PROFILES.block.rangedModifier,
    );
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
  function archerShot(formation: 'line' | 'column'): { damage: number; engagement: number } {
    const state = createEmptyState(6060);
    createGroupFromSpec(state, {
      id: 'bows',
      name: 'Bows',
      ownerId: 'player',
      anchor: { x: 4000, y: 3000 },
      formation,
      stance: 'defensive',
      composition: [['archer', 1]],
    });
    createGroupFromSpec(state, {
      id: 'target',
      name: 'Target',
      ownerId: 'enemy',
      anchor: { x: 4200, y: 3000 },
      formation: 'block',
      stance: 'defensive',
      composition: [['infantry', 1]],
    });
    const bows = findGroup(state, 'bows')!;
    const target = findGroup(state, 'target')!;
    state.units.targetIdx[bows.members[0]!] = target.members[0]!;
    advanceCombat(state);
    return {
      damage: UNIT_STATS.infantry.maxHitPoints - (state.units.hp[target.members[0]!] ?? 0),
      engagement: bows.engagement,
    };
  }

  it('lets archers fire beyond the old short range without physically pinning themselves', () => {
    expect(UNIT_STATS.archer.range).toBeGreaterThan(200);
    const shot = archerShot('line');
    expect(shot.damage).toBeGreaterThan(0);
    expect(shot.engagement).toBe(0);
  });

  it('rewards an archer line with a stronger volley than a column', () => {
    expect(archerShot('line').damage).toBeGreaterThan(archerShot('column').damage * 1.4);
  });

  it('resolves a combat tick simultaneously instead of favouring the first pool slots', () => {
    const state = createEmptyState(101);
    createGroupFromSpec(state, {
      id: 'first',
      name: 'First',
      ownerId: 'player',
      anchor: { x: 4000, y: 3000 },
      formation: 'block',
      stance: 'aggressive',
      composition: [['infantry', 1]],
    });
    createGroupFromSpec(state, {
      id: 'second',
      name: 'Second',
      ownerId: 'enemy',
      anchor: { x: 4000, y: 3010 },
      formation: 'block',
      stance: 'aggressive',
      composition: [['infantry', 1]],
    });
    const first = findGroup(state, 'first')!.members[0]!;
    const second = findGroup(state, 'second')!.members[0]!;
    state.units.hp[first] = 1;
    state.units.hp[second] = 1;
    state.units.targetIdx[first] = second;
    state.units.targetIdx[second] = first;

    advanceCombat(state);

    expect(state.units.alive[first]).toBe(0);
    expect(state.units.alive[second]).toBe(0);
  });

  it('drops a stale target when its recycled slot now belongs to the same faction', () => {
    const state = createEmptyState(202);
    createGroupFromSpec(state, {
      id: 'pursuer',
      name: 'Pursuer',
      ownerId: 'player',
      anchor: { x: 4000, y: 3000 },
      formation: 'block',
      stance: 'aggressive',
      composition: [['infantry', 1]],
    });
    createGroupFromSpec(state, {
      id: 'old-enemy',
      name: 'Old enemy',
      ownerId: 'enemy',
      anchor: { x: 4000, y: 3010 },
      formation: 'block',
      stance: 'aggressive',
      composition: [['infantry', 1]],
    });
    const pursuer = findGroup(state, 'pursuer')!.members[0]!;
    const recycled = findGroup(state, 'old-enemy')!.members[0]!;
    state.units.targetIdx[pursuer] = recycled;
    state.units.kill(recycled);
    const friendly = state.units.spawn(0, 0, 'infantry', 4000, 3010);
    expect(friendly).toBe(recycled);
    state.currentTick = 1; // not this unit's staggered reacquisition cohort

    advanceCombat(state);

    expect(state.units.targetIdx[pursuer]).toBe(-1);
    expect(state.units.hp[friendly]).toBe(UNIT_STATS.infantry.maxHitPoints);
  });

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

  function cavalryStrike(speed: number, formation: 'line' | 'square', stance: 'aggressive' | 'defensive'): number {
    const state = createEmptyState(8181);
    createGroupFromSpec(state, {
      id: 'horse',
      name: 'Horse',
      ownerId: 'player',
      anchor: { x: 4000, y: 3012 },
      formation: 'wedge',
      stance: 'aggressive',
      composition: [['cavalry', 1]],
    });
    createGroupFromSpec(state, {
      id: 'foot',
      name: 'Foot',
      ownerId: 'enemy',
      anchor: { x: 4000, y: 3000 },
      formation,
      stance,
      composition: [['infantry', 1]],
    });
    const attacker = findGroup(state, 'horse')!.members[0]!;
    const defender = findGroup(state, 'foot')!.members[0]!;
    state.units.velocityY[attacker] = -speed;
    state.currentTick = 3;
    advanceCombat(state);
    return UNIT_STATS.infantry.maxHitPoints - (state.units.hp[defender] ?? 0);
  }

  it('turns real approach speed into charge damage and lets a braced square absorb it', () => {
    const standing = cavalryStrike(0, 'line', 'aggressive');
    const charging = cavalryStrike(UNIT_STATS.cavalry.speed, 'line', 'aggressive');
    const braced = cavalryStrike(UNIT_STATS.cavalry.speed, 'square', 'defensive');

    expect(charging).toBeGreaterThan(standing * 1.35);
    expect(braced).toBeLessThan(charging * 0.6);
  });

  function pressureYield(stance: 'aggressive' | 'hold_ground'): number {
    const state = createEmptyState(9191);
    createGroupFromSpec(state, {
      id: 'press',
      name: 'Press',
      ownerId: 'player',
      anchor: { x: 4000, y: 3012 },
      formation: 'line',
      stance: 'aggressive',
      composition: [['cavalry', 10]],
    });
    createGroupFromSpec(state, {
      id: 'line',
      name: 'Line',
      ownerId: 'enemy',
      anchor: { x: 4000, y: 3000 },
      formation: 'line',
      stance,
      composition: [['infantry', 100]],
    });
    const attackers = findGroup(state, 'press')!;
    const defenders = findGroup(state, 'line')!;
    for (let index = 0; index < attackers.members.length; index += 1) {
      const attacker = attackers.members[index]!;
      const defender = defenders.members[index]!;
      state.units.x[attacker] = state.units.x[defender] ?? 0;
      state.units.y[attacker] = (state.units.y[defender] ?? 0) + 12;
      state.units.velocityY[attacker] = -UNIT_STATS.cavalry.speed;
      state.units.targetIdx[attacker] = defender;
    }
    const before = defenders.anchor.y;
    advanceCombat(state);
    return Math.abs(defenders.anchor.y - before);
  }

  it('makes a line yield under physical pressure while hold-ground resists it', () => {
    expect(pressureYield('aggressive')).toBeGreaterThan(pressureYield('hold_ground') * 1.4);
  });
});

describe('movement physics', () => {
  it('halts a missile-led assault to fire and wheels the formation toward its target', () => {
    const state = createEmptyState(7070);
    createGroupFromSpec(state, {
      id: 'bows',
      name: 'Bows',
      ownerId: 'player',
      anchor: { x: 4000, y: 3000 },
      formation: 'line',
      stance: 'aggressive',
      composition: [['archer', 12]],
    });
    createGroupFromSpec(state, {
      id: 'foe',
      name: 'Foe',
      ownerId: 'enemy',
      anchor: { x: 4200, y: 3000 },
      formation: 'block',
      stance: 'defensive',
      composition: [['infantry', 12]],
    });
    const bows = findGroup(state, 'bows')!;
    const foe = findGroup(state, 'foe')!;
    bows.order = {
      kind: 'attack_zone',
      targetZone: 'central_field',
      destination: { x: 4500, y: 3000 },
      issuedAtTick: 0,
    };
    bows.path = [{ x: 4500, y: 3000 }];
    for (let index = 0; index < bows.members.length; index += 1) {
      state.units.targetIdx[bows.members[index]!] = foe.members[index]!;
    }

    const beforeX = bows.anchor.x;
    const beforeFacing = bows.facing;
    advanceMovement(state);

    expect(bows.anchor.x).toBe(beforeX);
    expect(Math.abs(bows.facing)).toBeLessThan(Math.abs(beforeFacing));
  });

  it('separates overlapping friendly regiments without exposing soldier identities', () => {
    const state = createEmptyState(2020);
    for (const id of ['first', 'second']) {
      createGroupFromSpec(state, {
        id,
        name: id,
        ownerId: 'player',
        anchor: { x: 4000, y: 3400 },
        formation: 'block',
        stance: 'defensive',
        composition: [['infantry', 16]],
      });
    }
    const first = findGroup(state, 'first')!;
    const second = findGroup(state, 'second')!;
    for (let tick = 0; tick < 30; tick += 1) advanceMovement(state);

    let separation = 0;
    for (let index = 0; index < first.members.length; index += 1) {
      const a = first.members[index]!;
      const b = second.members[index]!;
      separation += Math.hypot(
        (state.units.x[a] ?? 0) - (state.units.x[b] ?? 0),
        (state.units.y[a] ?? 0) - (state.units.y[b] ?? 0),
      );
    }
    expect(separation / first.members.length).toBeGreaterThan(2.5);
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

/* ------------------------------------------------------- envelopment */

function centroidOf(state: GameState, groupId: string): { x: number; y: number } {
  const group = findGroup(state, groupId);
  if (group === undefined || group.members.length === 0) return { ...ANCHOR };
  let x = 0;
  let y = 0;
  for (const index of group.members) {
    x += state.units.x[index] ?? 0;
    y += state.units.y[index] ?? 0;
  }
  return { x: x / group.members.length, y: y / group.members.length };
}

function battle(state: GameState, ticks: number): void {
  for (let tick = 0; tick < ticks; tick += 1) {
    state.currentTick += 1;
    advanceMovement(state);
    advanceCombat(state);
    advanceMorale(state);
  }
}

/**
 * Six hundred men thrown at a regiment of six hundred, arriving either along a
 * single face or from all four quarters at once. The two assaults are identical
 * in numbers, troop type and stance, so only the geometry differs.
 */
function assault(kind: 'frontal' | 'ringed'): { survivors: number; encirclement: number } {
  const state = createEmptyState(4242);

  createGroupFromSpec(state, {
    id: 'held',
    name: 'Held',
    ownerId: 'enemy',
    anchor: { ...ANCHOR },
    formation: 'block',
    stance: 'defensive',
    composition: [['infantry', 600]],
  });

  const middle = centroidOf(state, 'held');

  const wings =
    kind === 'ringed'
      ? [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((bearing) => ({
          x: middle.x + Math.cos(bearing) * 320,
          y: middle.y + Math.sin(bearing) * 320,
          facing: bearing + Math.PI,
          goal: { x: middle.x, y: middle.y },
        }))
      : [-330, -110, 110, 330].map((offset) => ({
          x: middle.x + offset,
          y: middle.y + 320,
          facing: -Math.PI / 2,
          goal: { x: middle.x + offset, y: middle.y },
        }));

  wings.forEach((wing, n) => {
    createGroupFromSpec(state, {
      id: `wing_${n}`,
      name: `Wing ${n}`,
      ownerId: 'player',
      anchor: { x: wing.x, y: wing.y },
      formation: 'line',
      stance: 'defensive',
      composition: [['infantry', 150]],
    });
    const wingGroup = findGroup(state, `wing_${n}`);
    expect(wingGroup).toBeDefined();
    wingGroup!.facing = wing.facing;
    wingGroup!.path = [wing.goal];
    wingGroup!.order = { kind: 'attack_zone', issuedAtTick: 0 };
  });

  let worst = 0;
  for (let tick = 0; tick < TICKS_PER_SECOND * 45; tick += 1) {
    state.currentTick += 1;
    advanceMovement(state);
    advanceCombat(state);
    advanceMorale(state);
    const held = findGroup(state, 'held');
    if (held !== undefined && held.encirclement > worst) worst = held.encirclement;
  }

  return { survivors: findGroup(state, 'held')?.members.length ?? 0, encirclement: worst };
}

describe('envelopment', () => {
  it('destroys a regiment far faster when it is taken from every quarter', () => {
    const frontal = assault('frontal');
    const ringed = assault('ringed');

    // Men pressed along one face occupy only a couple of arcs; men who have
    // got all the way round occupy every one.
    expect(frontal.encirclement).toBeLessThan(0.5);
    expect(ringed.encirclement).toBeGreaterThan(0.75);

    // The same six hundred attackers, arranged well, are worth far more.
    expect(ringed.survivors).toBeLessThan(frontal.survivors * 0.6);
  });

  it('holds a marching column at a blocking line instead of letting it walk through', () => {
    const march = (withLine: boolean): number => {
      const state = createEmptyState(77);
      createGroupFromSpec(state, {
        id: 'column',
        name: 'Column',
        ownerId: 'enemy',
        anchor: { x: 4000, y: 2100 },
        formation: 'column',
        stance: 'aggressive',
        composition: [['infantry', 500]],
      });
      if (withLine) {
        createGroupFromSpec(state, {
          id: 'wall',
          name: 'Wall',
          ownerId: 'player',
          anchor: { x: 4000, y: 2750 },
          formation: 'line',
          stance: 'hold_ground',
          composition: [['spearman', 500]],
        });
      }

      const column = findGroup(state, 'column');
      expect(column).toBeDefined();
      expect(applyOrderToGroup(state, column!, 'move', { targetZone: 'player_base' }).ok).toBe(true);

      battle(state, TICKS_PER_SECOND * 50);
      return column!.anchor.y - 2100;
    };

    const unopposed = march(false);
    const opposed = march(true);

    // Unopposed the column crosses most of the map; held at the line it barely
    // reaches the far side of the river, which is the entire point of putting
    // troops on a crossing.
    expect(unopposed).toBeGreaterThan(1800);
    expect(opposed).toBeLessThan(unopposed * 0.5);
  });

  it('cuts down a formation that has already broken', () => {
    const chase = (broken: boolean): number => {
      const state = createEmptyState(5150);

      createGroupFromSpec(state, {
        id: 'pursuers',
        name: 'Pursuers',
        ownerId: 'player',
        anchor: { x: 4000, y: 3020 },
        formation: 'line',
        stance: 'aggressive',
        composition: [['cavalry', 140]],
      });
      createGroupFromSpec(state, {
        id: 'quarry',
        name: 'Quarry',
        ownerId: 'enemy',
        anchor: { x: 4000, y: 3000 },
        formation: 'block',
        stance: 'defensive',
        composition: [['infantry', 400]],
      });

      const quarry = findGroup(state, 'quarry');
      const pursuers = findGroup(state, 'pursuers');
      expect(quarry).toBeDefined();
      expect(pursuers).toBeDefined();
      // The horse ride after them; a rout is only decisive if somebody follows.
      pursuers!.path = [{ x: 4000, y: 2200 }];
      pursuers!.order = { kind: 'attack_zone', issuedAtTick: 0 };

      // Morale is held fixed on both runs so the comparison isolates what
      // happens to men who have turned their backs.
      for (let tick = 0; tick < TICKS_PER_SECOND * 12; tick += 1) {
        state.currentTick += 1;
        quarry!.routing = broken;
        advanceMovement(state);
        advanceCombat(state);
      }
      return quarry!.members.length;
    };

    const broken = chase(true);
    const standing = chase(false);
    expect(standing).toBeGreaterThan(0);
    expect(broken).toBeLessThan(standing * 0.75);
  });
});

/**
 * The press, exhaustion, and the ground at a crossing.
 *
 * These are the terms that stop one enormous mass of men from being the answer
 * to every problem on the map, so each one is pinned down here directly rather
 * than left to be inferred from the outcome of a battle.
 */
describe('the press of men', () => {
  function pack(count: number, formation: 'block' | 'loose'): number {
    const state = createEmptyState(5150);
    for (let n = 0; n < count; n += 1) {
      createGroupFromSpec(state, {
        id: `packed_${n}`,
        name: `Packed ${n}`,
        ownerId: 'player',
        anchor: { x: 4000, y: 3000 },
        formation,
        stance: 'hold_ground',
        composition: [['infantry', 400]],
      });
    }
    // Crowding is smoothed, so it needs a moment to settle on its reading.
    for (let tick = 0; tick < 120; tick += 1) {
      state.currentTick += 1;
      advanceCombat(state);
    }
    return findGroup(state, 'packed_0')?.crowding ?? -1;
  }

  it('leaves a formation at its own spacing alone and crushes regiments stacked on one another', () => {
    expect(pack(1, 'block')).toBeLessThan(0.05);
    expect(pack(1, 'loose')).toBeLessThan(0.05);
    expect(pack(3, 'block')).toBeGreaterThan(0.8);
  });

  function blowWith(mutate: (group: ArmyGroup) => void): number {
    const state = createEmptyState(6160);
    createGroupFromSpec(state, {
      id: 'striker',
      name: 'Striker',
      ownerId: 'player',
      anchor: { x: 4000, y: 3012 },
      formation: 'block',
      stance: 'defensive',
      composition: [['infantry', 1]],
    });
    createGroupFromSpec(state, {
      id: 'target',
      name: 'Target',
      ownerId: 'enemy',
      anchor: { x: 4000, y: 3000 },
      formation: 'block',
      stance: 'defensive',
      composition: [['infantry', 1]],
    });
    const striker = findGroup(state, 'striker')!;
    const target = findGroup(state, 'target')!;
    mutate(striker);
    state.units.targetIdx[striker.members[0]!] = target.members[0]!;
    state.currentTick = 3;
    advanceCombat(state);
    return UNIT_STATS.infantry.maxHitPoints - (state.units.hp[target.members[0]!] ?? 0);
  }

  it('takes the fight out of men who are crushed together or worn out', () => {
    const fresh = blowWith(() => {});
    const crushed = blowWith((group) => {
      group.crowding = 1;
    });
    const spent = blowWith((group) => {
      group.fatigue = 1;
    });

    expect(crushed).toBeLessThan(fresh * (1 - CROWDING.damagePenalty * 0.85));
    expect(spent).toBeLessThan(fresh * (1 - FATIGUE.damagePenalty * 0.85));
  });

  function shotAt(crowding: number): number {
    const state = createEmptyState(6161);
    createGroupFromSpec(state, {
      id: 'bows',
      name: 'Bows',
      ownerId: 'player',
      anchor: { x: 4000, y: 3100 },
      formation: 'block',
      stance: 'defensive',
      composition: [['archer', 1]],
    });
    createGroupFromSpec(state, {
      id: 'column',
      name: 'Column',
      ownerId: 'enemy',
      anchor: { x: 4000, y: 3000 },
      formation: 'block',
      stance: 'defensive',
      composition: [['infantry', 1]],
    });
    const bows = findGroup(state, 'bows')!;
    const column = findGroup(state, 'column')!;
    column.crowding = crowding;
    state.units.targetIdx[bows.members[0]!] = column.members[0]!;
    state.currentTick = 3;
    advanceCombat(state);
    return UNIT_STATS.infantry.maxHitPoints - (state.units.hp[column.members[0]!] ?? 0);
  }

  it('makes a crushed formation far worse ground to be shot at on', () => {
    expect(shotAt(1)).toBeGreaterThan(shotAt(0) * 1.4);
  });

});

describe('crossings', () => {
  /**
   * One blow struck at a defender formed on the far bank, by a man either still
   * on the bridge or already off it. Positions are written straight into the
   * pool: the deployment helper would move an anchor off the water, which is
   * exactly the ground being tested.
   */
  function blowFromTheCrossing(fromTheBridge: boolean): number {
    const state = createEmptyState(9192);
    useBattleMap('river_vale');
    const bridgeX = 4000;
    const centre = barrierCenterAt(bridgeX);

    createGroupFromSpec(state, {
      id: 'storming',
      name: 'Storming',
      ownerId: 'player',
      anchor: { x: bridgeX, y: 3000 },
      formation: 'block',
      stance: 'defensive',
      composition: [['infantry', 1]],
    });
    createGroupFromSpec(state, {
      id: 'holding',
      name: 'Holding',
      ownerId: 'enemy',
      anchor: { x: bridgeX, y: 2000 },
      formation: 'block',
      stance: 'defensive',
      composition: [['infantry', 1]],
    });

    const storming = findGroup(state, 'storming')!;
    const holding = findGroup(state, 'holding')!;
    const attacker = storming.members[0]!;
    const defender = holding.members[0]!;

    // Either side of the north bank, or either side of the waterline. The two
    // men stand the same ten paces apart in both cases.
    const defenderY = fromTheBridge ? centre - 140 : centre - 160;
    const attackerY = defenderY + 10;
    state.units.x[attacker] = bridgeX;
    state.units.y[attacker] = attackerY;
    state.units.x[defender] = bridgeX;
    state.units.y[defender] = defenderY;
    storming.anchor.y = attackerY;
    holding.anchor.y = defenderY;
    state.units.targetIdx[attacker] = defender;

    state.currentTick = 3;
    advanceCombat(state);
    return UNIT_STATS.infantry.maxHitPoints - (state.units.hp[defender] ?? 0);
  }

  it('costs an assault most of its weight while it is still fighting off the bridge', () => {
    const formed = blowFromTheCrossing(false);
    const onTheBridge = blowFromTheCrossing(true);
    expect(onTheBridge).toBeLessThan(formed * 0.8);
  });
});

describe('exhaustion', () => {
  function endure(engagement: number, marching: boolean, ticks: number): number {
    const state = createEmptyState(7170);
    createGroupFromSpec(state, {
      id: 'weary',
      name: 'Weary',
      ownerId: 'player',
      anchor: { x: 4000, y: 3000 },
      formation: 'block',
      stance: 'defensive',
      composition: [['infantry', 100]],
    });
    const group = findGroup(state, 'weary')!;
    for (let tick = 0; tick < ticks; tick += 1) {
      state.currentTick += 1;
      group.engagement = engagement;
      group.path = marching ? [{ x: 4000, y: 2000 }] : [];
      advanceFatigue(state);
    }
    return group.fatigue;
  }

  it('wears men down in contact faster than on the march, and rests them out of both', () => {
    const fought = endure(1, false, TICKS_PER_SECOND * 60);
    const marched = endure(0, true, TICKS_PER_SECOND * 60);
    expect(fought).toBeGreaterThan(0.6);
    expect(marched).toBeGreaterThan(0);
    expect(marched).toBeLessThan(fought * 0.5);

    // The same regiment, left standing out of contact, gets its wind back.
    const state = createEmptyState(7170);
    createGroupFromSpec(state, {
      id: 'weary',
      name: 'Weary',
      ownerId: 'player',
      anchor: { x: 4000, y: 3000 },
      formation: 'block',
      stance: 'defensive',
      composition: [['infantry', 100]],
    });
    const group = findGroup(state, 'weary')!;
    group.fatigue = 1;
    for (let tick = 0; tick < TICKS_PER_SECOND * 60; tick += 1) {
      state.currentTick += 1;
      advanceFatigue(state);
    }
    expect(group.fatigue).toBeLessThan(0.6);
  });
});

describe('terrain and navigation', () => {
  // These assertions are about River Vale's geography specifically.
  useBattleMap('river_vale');

  it('makes the river impassable except at the crossings', () => {
    // Mid-river, far from any crossing.
    expect(isPassable(3000, barrierCenterAt(3000))).toBe(false);
    // On the central bridge.
    expect(isPassable(4000, barrierCenterAt(4000))).toBe(true);
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
        if (Math.abs(y - barrierCenterAt(x)) < 40) {
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

  it('reserves formation clearance instead of grazing an obstacle with the anchor', () => {
    useBattleMap('goldmere');
    const from = { x: 2000, y: 2535 };
    const to = { x: 3700, y: 2535 };
    expect(hasClearLineOfMarch(from, to)).toBe(true);
    expect(hasClearLineOfMarch(from, to, 60)).toBe(false);

    const path = computePath(from, to, 60);
    expect(path.length).toBeGreaterThan(1);
    let cursor = from;
    for (const waypoint of path) {
      expect(hasClearLineOfMarch(cursor, waypoint, 60)).toBe(true);
      cursor = waypoint;
    }
    useBattleMap('river_vale');
  });
});

