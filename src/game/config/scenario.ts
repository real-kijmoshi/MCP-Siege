import { fillFormationSlots } from '../simulation/Formations';
import { findGroup, registerGroup, type GameState } from '../simulation/GameState';
import { zoneAt } from '../simulation/Zones';
import {
  factionOf,
  type ArmyGroup,
  type Formation,
  type PlayerId,
  type Stance,
  type UnitCategory,
  type Vector2D,
  type ZoneId,
} from '../types/domain';

/**
 * The one contest scenario.
 *
 * A river splits the map. The player holds the southern bank with a centre of
 * mass at the bridge; the enemy holds the north with prepared positions and two
 * cavalry wings. The opening is quiet enough to command by hand, and the
 * escalation timeline in `Escalation.ts` deliberately overloads a single human
 * a few minutes in — which is the moment the Marshal earns its place.
 */

export interface GroupSpec {
  id: string;
  name: string;
  ownerId: PlayerId;
  anchor: Vector2D;
  formation: Formation;
  stance: Stance;
  composition: ReadonlyArray<readonly [UnitCategory, number]>;
}

/** North is negative Y, so the player looks up the map and the enemy looks down. */
const FACING_NORTH = -Math.PI / 2;
const FACING_SOUTH = Math.PI / 2;

export const PLAYER_GROUPS: readonly GroupSpec[] = [
  {
    id: 'legion_i',
    name: 'Legion I',
    ownerId: 'player',
    anchor: { x: 3480, y: 3150 },
    formation: 'line',
    stance: 'defensive',
    composition: [['infantry', 640], ['heavy_infantry', 260]],
  },
  {
    id: 'legion_ii',
    name: 'Legion II',
    ownerId: 'player',
    anchor: { x: 4520, y: 3180 },
    formation: 'line',
    stance: 'defensive',
    composition: [['infantry', 560], ['heavy_infantry', 140]],
  },
  {
    id: 'spearwall',
    name: 'Spearwall',
    ownerId: 'player',
    anchor: { x: 4000, y: 2930 },
    formation: 'double_line',
    stance: 'hold_ground',
    composition: [['spearman', 400]],
  },
  {
    id: 'archers_i',
    name: 'Archers I',
    ownerId: 'player',
    anchor: { x: 4000, y: 3560 },
    formation: 'double_line',
    stance: 'defensive',
    composition: [['archer', 450]],
  },
  {
    id: 'cavalry_i',
    name: 'Cavalry I',
    ownerId: 'player',
    anchor: { x: 1950, y: 3320 },
    formation: 'wedge',
    stance: 'aggressive',
    composition: [['cavalry', 260]],
  },
  {
    id: 'cavalry_ii',
    name: 'Cavalry II',
    ownerId: 'player',
    anchor: { x: 6480, y: 3320 },
    formation: 'wedge',
    stance: 'aggressive',
    composition: [['cavalry', 180]],
  },
  {
    id: 'siege_corps',
    name: 'Siege Corps',
    ownerId: 'player',
    anchor: { x: 4950, y: 3060 },
    formation: 'loose',
    stance: 'hold_ground',
    composition: [['siege', 40]],
  },
  {
    id: 'scouts',
    name: 'Scouts',
    ownerId: 'player',
    anchor: { x: 5700, y: 3250 },
    formation: 'loose',
    stance: 'defensive',
    composition: [['scout', 40]],
  },
  {
    id: 'reserve_i',
    name: 'Reserve I',
    ownerId: 'player',
    anchor: { x: 4000, y: 4420 },
    formation: 'block',
    stance: 'defensive',
    composition: [['infantry', 400], ['spearman', 120], ['archer', 80]],
  },
  {
    id: 'royal_guard',
    name: 'Royal Guard',
    ownerId: 'player',
    anchor: { x: 4000, y: 4620 },
    formation: 'square',
    stance: 'hold_ground',
    composition: [['heavy_infantry', 260], ['spearman', 120]],
  },
];

export const ENEMY_GROUPS: readonly GroupSpec[] = [
  {
    id: 'iron_host',
    name: 'Iron Host',
    ownerId: 'enemy',
    anchor: { x: 3780, y: 1660 },
    formation: 'line',
    stance: 'defensive',
    composition: [['infantry', 700], ['heavy_infantry', 250]],
  },
  {
    id: 'ash_legion',
    name: 'Ash Legion',
    ownerId: 'enemy',
    anchor: { x: 4680, y: 1660 },
    formation: 'line',
    stance: 'defensive',
    composition: [['infantry', 700]],
  },
  {
    id: 'northern_spears',
    name: 'Northern Spears',
    ownerId: 'enemy',
    anchor: { x: 4200, y: 1960 },
    formation: 'double_line',
    stance: 'hold_ground',
    composition: [['spearman', 380]],
  },
  {
    id: 'black_arrows',
    name: 'Black Arrows',
    ownerId: 'enemy',
    anchor: { x: 4200, y: 1230 },
    formation: 'double_line',
    stance: 'defensive',
    composition: [['archer', 480]],
  },
  {
    id: 'storm_riders',
    name: 'Storm Riders',
    ownerId: 'enemy',
    anchor: { x: 2480, y: 1520 },
    formation: 'wedge',
    stance: 'aggressive',
    composition: [['cavalry', 300]],
  },
  {
    id: 'night_riders',
    name: 'Night Riders',
    ownerId: 'enemy',
    anchor: { x: 6350, y: 1780 },
    formation: 'wedge',
    stance: 'aggressive',
    composition: [['cavalry', 220]],
  },
  {
    id: 'siege_train',
    name: 'Siege Train',
    ownerId: 'enemy',
    anchor: { x: 4000, y: 940 },
    formation: 'loose',
    stance: 'hold_ground',
    composition: [['siege', 45]],
  },
  {
    id: 'outriders',
    name: 'Outriders',
    ownerId: 'enemy',
    anchor: { x: 5400, y: 1620 },
    formation: 'loose',
    stance: 'defensive',
    composition: [['scout', 45]],
  },
  {
    id: 'ashen_reserve',
    name: 'Ashen Reserve',
    ownerId: 'enemy',
    anchor: { x: 4000, y: 840 },
    formation: 'block',
    stance: 'defensive',
    composition: [['infantry', 380], ['spearman', 120]],
  },
  {
    id: 'ashen_guard',
    name: 'Ashen Guard',
    ownerId: 'enemy',
    anchor: { x: 4000, y: 560 },
    formation: 'square',
    stance: 'hold_ground',
    composition: [['heavy_infantry', 260], ['spearman', 120]],
  },
];

/**
 * The two sovereigns.
 *
 * Each rides with the guard named here, which is the only reason a king is ever
 * reachable: to take one you must first break or draw off the regiment around
 * him. Neither king is a unit — see `simulation/Objective.ts`.
 */
export interface KingSpec {
  ownerId: PlayerId;
  name: string;
  guardGroupId: string;
}

export const KING_SPECS: readonly KingSpec[] = [
  { ownerId: 'player', name: 'King Aldric', guardGroupId: 'royal_guard' },
  { ownerId: 'enemy', name: 'The Ashen King', guardGroupId: 'ashen_guard' },
];

/* -------------------------------------------------------------- construction */

const slotBufferX = new Float32Array(2048);
const slotBufferY = new Float32Array(2048);

/**
 * Creates a group and spawns its units directly onto their formation slots, so
 * the battle opens with every army already dressed in formation.
 */
export function createGroupFromSpec(state: GameState, spec: GroupSpec): ArmyGroup {
  const facing = spec.ownerId === 'player' ? FACING_NORTH : FACING_SOUTH;
  const total = spec.composition.reduce((sum, [, count]) => sum + count, 0);
  const slot = state.groups.length;

  const group: ArmyGroup = {
    id: spec.id,
    name: spec.name,
    ownerId: spec.ownerId,
    members: [],
    formation: spec.formation,
    stance: spec.stance,
    order: { kind: 'idle', issuedAtTick: 0 },
    anchor: { x: spec.anchor.x, y: spec.anchor.y },
    facing,
    morale: 100,
    moraleState: 'confident',
    path: [],
    initialStrength: total,
    homeZone: zoneAt(spec.anchor.x, spec.anchor.y) as ZoneId,
    lastCasualtyTick: -1,
    recentCasualties: 0,
    routing: false,
  };

  const xs = total <= slotBufferX.length ? slotBufferX : new Float32Array(total);
  const ys = total <= slotBufferY.length ? slotBufferY : new Float32Array(total);
  fillFormationSlots(spec.formation, total, group.anchor, facing, xs, ys);

  const faction = factionOf(spec.ownerId);
  let slotIndex = 0;
  for (const [category, count] of spec.composition) {
    for (let n = 0; n < count; n += 1) {
      const x = xs[slotIndex] ?? group.anchor.x;
      const y = ys[slotIndex] ?? group.anchor.y;
      const unitIndex = state.units.spawn(faction, slot, category, x, y);
      if (unitIndex >= 0) group.members.push(unitIndex);
      slotIndex += 1;
    }
  }

  group.members.sort((a, b) => a - b);
  group.initialStrength = group.members.length;
  registerGroup(state, group);
  return group;
}

export function buildScenario(state: GameState): void {
  for (const spec of PLAYER_GROUPS) createGroupFromSpec(state, spec);
  for (const spec of ENEMY_GROUPS) createGroupFromSpec(state, spec);
  seatKings(state);
}

/**
 * Seats both kings with their guards and records the strength each side is
 * measured against, so a general collapse can be recognised later.
 */
function seatKings(state: GameState): void {
  for (const spec of KING_SPECS) {
    const guard = findGroup(state, spec.guardGroupId);
    if (guard === undefined) throw new Error(`Missing royal guard "${spec.guardGroupId}".`);

    state.objective.kings[spec.ownerId] = {
      ownerId: spec.ownerId,
      name: spec.name,
      position: { x: guard.anchor.x, y: guard.anchor.y },
      guardGroupId: spec.guardGroupId,
      guardStrength: guard.members.length,
      captureProgress: 0,
      captured: false,
      besieged: false,
      defenders: guard.members.length,
      attackers: 0,
    };
  }

  for (const group of state.groups) {
    state.objective.initialStrength[group.ownerId] += group.members.length;
  }
}
