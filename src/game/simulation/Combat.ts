import {
  ACQUISITION_MARGIN,
  ACQUISITION_STRIDE,
  FORMATION_PROFILES,
  STANCE_PROFILES,
  UNIT_STATS,
  counterMultiplier,
} from '../config/battle';
import { FACTION_ENEMY, FACTION_PLAYER, type ArmyGroup, type CombatEvent } from '../types/domain';
import type { GameState } from './GameState';
import { SpatialHash } from './SpatialHash';
import { UnitPool } from './UnitPool';
import { isDefensiveTerrain } from './Zones';

/**
 * Combat resolution.
 *
 * Target acquisition is staggered across ticks so only a fraction of the army
 * runs a search each step, while damage still resolves every tick. Everything
 * iterates in unit-index order, so the outcome is reproducible.
 */

const hashes = [new SpatialHash(10_000), new SpatialHash(10_000)];

const MAX_EVENTS = 320;
const EVENT_SAMPLE = 11;
let eventCounter = 0;

function recordEvent(state: GameState, event: CombatEvent): void {
  eventCounter += 1;
  if (eventCounter % EVENT_SAMPLE !== 0) return;
  if (state.combatEvents.length >= MAX_EVENTS) state.combatEvents.shift();
  state.combatEvents.push(event);
}

function groupOf(state: GameState, unitIndex: number): ArmyGroup | undefined {
  const slot = state.units.group[unitIndex] ?? -1;
  return slot < 0 ? undefined : state.groups[slot];
}

/**
 * Damage for one blow, folding together the counter matrix, both formations,
 * both stances, terrain and the attacker's morale.
 */
function computeDamage(
  state: GameState,
  attacker: number,
  defender: number,
  attackerGroup: ArmyGroup | undefined,
  defenderGroup: ArmyGroup | undefined,
): number {
  const units = state.units;
  const attackerCategory = units.categoryOf(attacker);
  const defenderCategory = units.categoryOf(defender);
  const stats = UNIT_STATS[attackerCategory];

  let damage = stats.attack * counterMultiplier(attackerCategory, defenderCategory);

  if (attackerGroup !== undefined) {
    damage *= STANCE_PROFILES[attackerGroup.stance].damageModifier;
    // Shaken troops fight poorly even before they break.
    damage *= 0.6 + 0.4 * (attackerGroup.morale / 100);
    if (stats.range < 100) damage *= FORMATION_PROFILES[attackerGroup.formation].meleeModifier;
  }

  if (defenderGroup !== undefined) {
    const profile = FORMATION_PROFILES[defenderGroup.formation];
    damage *= STANCE_PROFILES[defenderGroup.stance].damageTakenModifier;
    if (stats.range >= 100) damage *= profile.rangedVulnerability;
    if (attackerCategory === 'cavalry') damage /= profile.antiCavalry;
  }

  if (isDefensiveTerrain(units.x[defender] ?? 0, units.y[defender] ?? 0)) damage *= 0.85;

  return damage;
}

function applyDamage(state: GameState, defender: number, damage: number): void {
  const units = state.units;
  const remaining = (units.hp[defender] ?? 0) - damage;
  if (remaining > 0) {
    units.hp[defender] = remaining;
    return;
  }

  const group = groupOf(state, defender);
  units.kill(defender);
  if (group !== undefined) {
    group.recentCasualties += 1;
    group.lastCasualtyTick = state.currentTick;
  }
}

/** Siege shells splash, and dense formations suffer badly for it. */
function applySplash(
  state: GameState,
  attacker: number,
  defender: number,
  baseDamage: number,
  radius: number,
): void {
  const units = state.units;
  const defenderFaction = units.owner[defender] ?? FACTION_ENEMY;
  const hash = hashes[defenderFaction];
  if (hash === undefined) return;

  const centerX = units.x[defender] ?? 0;
  const centerY = units.y[defender] ?? 0;

  hash.forEachNear(centerX, centerY, radius, units, (victim) => {
    if (victim === defender) return;
    const victimGroup = groupOf(state, victim);
    const vulnerability =
      victimGroup === undefined
        ? 1
        : FORMATION_PROFILES[victimGroup.formation].splashVulnerability;
    // Falls off with distance so the centre of the blast is the worst place.
    const dx = (units.x[victim] ?? 0) - centerX;
    const dy = (units.y[victim] ?? 0) - centerY;
    const falloff = 1 - Math.min(1, Math.hypot(dx, dy) / radius);
    applyDamage(state, victim, baseDamage * 0.55 * falloff * vulnerability);
  });

  void attacker;
}

export function advanceCombat(state: GameState): void {
  const units = state.units;
  const playerHash = hashes[FACTION_PLAYER];
  const enemyHash = hashes[FACTION_ENEMY];
  if (playerHash === undefined || enemyHash === undefined) return;

  playerHash.build(units, FACTION_PLAYER);
  enemyHash.build(units, FACTION_ENEMY);

  const phase = state.currentTick % ACQUISITION_STRIDE;

  for (let index = 0; index < units.count; index += 1) {
    if (units.alive[index] !== 1) continue;

    const cooldown = units.cooldown[index] ?? 0;
    if (cooldown > 0) units.cooldown[index] = cooldown - 1;

    const category = units.categoryOf(index);
    const stats = UNIT_STATS[category];
    const x = units.x[index] ?? 0;
    const y = units.y[index] ?? 0;

    let target = units.targetIdx[index] ?? -1;
    const targetLost =
      target < 0 ||
      units.alive[target] !== 1 ||
      Math.hypot((units.x[target] ?? 0) - x, (units.y[target] ?? 0) - y) >
        stats.range + ACQUISITION_MARGIN;

    if (targetLost && index % ACQUISITION_STRIDE === phase) {
      const opposing = units.owner[index] === FACTION_PLAYER ? enemyHash : playerHash;
      target = opposing.findNearest(x, y, stats.range + ACQUISITION_MARGIN, units);
      units.targetIdx[index] = target;
    } else if (targetLost) {
      units.targetIdx[index] = -1;
      target = -1;
    }

    if (target < 0 || units.alive[target] !== 1) continue;

    const dx = (units.x[target] ?? 0) - x;
    const dy = (units.y[target] ?? 0) - y;
    if (dx * dx + dy * dy > stats.range * stats.range) continue;
    if ((units.cooldown[index] ?? 0) > 0) continue;

    const attackerGroup = groupOf(state, index);
    const defenderGroup = groupOf(state, target);

    // A routed unit runs; it does not stop to trade blows.
    if (attackerGroup?.routing === true) continue;

    const damage = computeDamage(state, index, target, attackerGroup, defenderGroup);
    units.cooldown[index] = stats.cooldownTicks;

    recordEvent(state, {
      x,
      y,
      targetX: units.x[target] ?? 0,
      targetY: units.y[target] ?? 0,
      kind: stats.splashRadius > 0 ? 'siege' : stats.range >= 100 ? 'arrow' : 'melee',
      tick: state.currentTick,
    });

    if (stats.splashRadius > 0) {
      applySplash(state, index, target, damage, stats.splashRadius);
    }
    applyDamage(state, target, damage);
  }

  compactGroups(state);
}

/**
 * Removes the dead from group rosters in place, so ranks close up without
 * allocating a new array for every group every tick.
 */
function compactGroups(state: GameState): void {
  const units = state.units;
  for (const group of state.groups) {
    const members = group.members;
    if (members.length === 0) continue;
    let write = 0;
    for (let read = 0; read < members.length; read += 1) {
      const index = members[read];
      if (index !== undefined && units.alive[index] === 1) {
        members[write] = index;
        write += 1;
      }
    }
    members.length = write;
  }
}

/** Exposed so vision and intelligence can reuse the freshly built index. */
export function factionHash(faction: number): SpatialHash | undefined {
  return hashes[faction];
}

/** Test seam: rebuilds the hashes without resolving a combat round. */
export function rebuildHashes(pool: UnitPool): void {
  hashes[FACTION_PLAYER]?.build(pool, FACTION_PLAYER);
  hashes[FACTION_ENEMY]?.build(pool, FACTION_ENEMY);
}
