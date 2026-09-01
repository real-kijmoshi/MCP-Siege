import {
  ACQUISITION_MARGIN,
  ACQUISITION_STRIDE,
  CONTACT,
  FORMATION_PROFILES,
  REACQUISITION_STRIDE,
  STANCE_PROFILES,
  UNIT_STATS,
  counterMultiplier,
} from '../config/battle';
import { FACTION_ENEMY, FACTION_PLAYER, type ArmyGroup, type CombatEvent } from '../types/domain';
import type { GameState } from './GameState';
import { nextRandom } from './Random';
import { SpatialHash } from './SpatialHash';
import { UnitPool } from './UnitPool';
import { isPassable, terrainAt } from './Zones';

/**
 * Combat resolution.
 *
 * Target acquisition is staggered across ticks so only a fraction of the army
 * runs a search each step, while damage still resolves every tick. Everything
 * iterates in unit-index order, so the outcome is reproducible.
 */

const hashes = [new SpatialHash(10_000), new SpatialHash(10_000)];

/**
 * Per-tick contact scratch, indexed by group slot. Both are fully cleared at
 * the top of every round, so nothing carries across ticks and two engines in
 * one process cannot interfere. What survives the tick is folded back onto the
 * group records themselves.
 */
let contactCounts = new Int32Array(64);
/** `arcCounts[slot * CONTACT.arcCount + arc]` — men bearing on a group per arc. */
let arcCounts = new Int32Array(64 * CONTACT.arcCount);
let pressureX = new Float32Array(64);
let pressureY = new Float32Array(64);

/** Minimum real body of troops that must press from one arc for it to count. */
const MIN_ARC_CONTACT = 4;

function ensureContactBuffers(groupCount: number): void {
  if (contactCounts.length >= groupCount) {
    contactCounts.fill(0, 0, groupCount);
    arcCounts.fill(0, 0, groupCount * CONTACT.arcCount);
    pressureX.fill(0, 0, groupCount);
    pressureY.fill(0, 0, groupCount);
    return;
  }
  let capacity = contactCounts.length;
  while (capacity < groupCount) capacity *= 2;
  contactCounts = new Int32Array(capacity);
  arcCounts = new Int32Array(capacity * CONTACT.arcCount);
  pressureX = new Float32Array(capacity);
  pressureY = new Float32Array(capacity);
}

const ARC_WIDTH = (Math.PI * 2) / CONTACT.arcCount;

/** Which of the eight arcs around a formation a bearing falls in. */
function arcIndex(dx: number, dy: number): number {
  let angle = Math.atan2(dy, dx);
  if (angle < 0) angle += Math.PI * 2;
  const arc = Math.floor(angle / ARC_WIDTH);
  return arc >= CONTACT.arcCount ? CONTACT.arcCount - 1 : arc;
}

/** Smallest angle between two headings, 0..PI. */
function angleBetween(first: number, second: number): number {
  let spread = Math.abs(first - second);
  while (spread > Math.PI * 2) spread -= Math.PI * 2;
  if (spread > Math.PI) spread = Math.PI * 2 - spread;
  return spread;
}

const MAX_EVENTS = 320;
const EVENT_SAMPLE = 11;

function recordEvent(state: GameState, attacker: number, event: CombatEvent): void {
  if ((attacker * 17 + state.currentTick * 31) % EVENT_SAMPLE !== 0) return;
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
  const dx = (units.x[defender] ?? 0) - (units.x[attacker] ?? 0);
  const dy = (units.y[defender] ?? 0) - (units.y[attacker] ?? 0);
  const attackDistance = Math.hypot(dx, dy);

  if (stats.range >= 100) {
    const rangeShare = Math.min(1, attackDistance / stats.range);
    damage *= 1 - rangeShare * rangeShare * 0.2;
  }

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

    // Where the blow lands on the formation. A regiment is only strong along
    // the front it is dressed to; men taken from the side have to turn, and men
    // taken from behind never see it coming. This is what pays a commander back
    // for the manoeuvring that got troops around a flank.
    const bearing = Math.atan2(
      (units.y[attacker] ?? 0) - defenderGroup.anchor.y,
      (units.x[attacker] ?? 0) - defenderGroup.anchor.x,
    );
    const offAxis = angleBetween(bearing, defenderGroup.facing);
    if (offAxis > CONTACT.flankArc) damage *= CONTACT.rearDamage;
    else if (offAxis > CONTACT.frontArc) damage *= CONTACT.flankDamage;

    // A moving body carries shock into its first blows. A steady spear front
    // or square braces that shock, but only when it arrives from the front.
    if (stats.range < 100 && stats.chargePower > 0) {
      const velocity = Math.hypot(
        units.velocityX[attacker] ?? 0,
        units.velocityY[attacker] ?? 0,
      );
      const speedShare = Math.min(1, velocity / Math.max(0.001, stats.speed));
      const charge =
        Math.max(0, (speedShare - 0.2) / 0.8) *
        Math.min(CONTACT.maximumChargeDamage, stats.chargePower);
      const braced =
        offAxis <= CONTACT.frontArc &&
        defenderGroup.stance !== 'aggressive' &&
        (defenderGroup.formation === 'square' || defenderCategory === 'spearman');
      damage *= 1 + charge * (braced ? 1 - CONTACT.braceReduction : 1);
    }

    // Being attacked from every quarter at once. Ranks cannot close, there is
    // nowhere to give ground, and every man is fighting two.
    damage *= 1 + CONTACT.encirclementDamage * defenderGroup.encirclement;

    // Men who have already broken are being cut down, not fought.
    if (defenderGroup.routing) damage *= CONTACT.pursuitDamage;
  }

  const defenderTerrain = terrainAt(units.x[defender] ?? 0, units.y[defender] ?? 0);
  if (defenderTerrain === 'village') damage *= 0.78;
  else if (defenderTerrain === 'hill') damage *= 0.82;
  else if (defenderTerrain === 'forest') {
    damage *= stats.range >= 100 ? 0.7 : attackerCategory === 'cavalry' ? 0.72 : 0.86;
  }
  if (
    stats.range >= 100 &&
    terrainAt(units.x[attacker] ?? 0, units.y[attacker] ?? 0) === 'hill'
  ) {
    damage *= 1.12;
  }

  damage *= 0.9 + nextRandom(state.random) * 0.2;

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

  ensureContactBuffers(state.groups.length);

  for (let index = 0; index < units.count; index += 1) {
    if (units.alive[index] !== 1) continue;

    const cooldown = units.cooldown[index] ?? 0;
    if (cooldown > 0) units.cooldown[index] = cooldown - 1;

    const category = units.categoryOf(index);
    const stats = UNIT_STATS[category];
    const x = units.x[index] ?? 0;
    const y = units.y[index] ?? 0;

    const stored = units.targetIdx[index] ?? -1;
    const hasLiveTarget = stored >= 0 && units.alive[stored] === 1;
    let target = stored;
    const targetLost =
      !hasLiveTarget ||
      Math.hypot((units.x[stored] ?? 0) - x, (units.y[stored] ?? 0) - y) >
        stats.range + ACQUISITION_MARGIN;

    // A man with nobody to fight looks around far more often than one merely
    // hoping for a better target, so a melee does not stall every time the
    // enemy in front of him falls.
    const stride = hasLiveTarget ? ACQUISITION_STRIDE : REACQUISITION_STRIDE;

    if (targetLost && index % stride === state.currentTick % stride) {
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

    const attackerGroup = groupOf(state, index);
    const defenderGroup = groupOf(state, target);

    // A routed unit runs; it does not stop to trade blows, and it holds nobody
    // in place by standing there.
    if (attackerGroup?.routing === true) continue;

    // Contact is recorded for everyone within reach of an enemy, not only for
    // the men whose blow happens to land this tick. A regiment attacks once
    // every second or so, and sampling only those few strikes made the picture
    // of who was pressing where flicker far too much to steer on.
    // Men who have broken hold nobody in place, so chasing them does not pin
    // the pursuit. Without this exception cavalry sent after a rout were slowed
    // to a crawl by the very men they were riding down, and the rout escaped.
    const attackerSlot = units.group[index] ?? -1;
    if (attackerSlot >= 0 && defenderGroup?.routing !== true) {
      contactCounts[attackerSlot] = (contactCounts[attackerSlot] ?? 0) + 1;
    }

    const defenderSlot = units.group[target] ?? -1;
    if (defenderSlot >= 0 && defenderGroup !== undefined) {
      const arc = arcIndex(x - defenderGroup.anchor.x, y - defenderGroup.anchor.y);
      const bucket = defenderSlot * CONTACT.arcCount + arc;
      arcCounts[bucket] = (arcCounts[bucket] ?? 0) + 1;
    }

    if (defenderSlot >= 0 && stats.range < 100) {
      const distance = Math.hypot(dx, dy);
      if (distance > 0.001) {
        const speedShare = Math.min(
          1,
          Math.hypot(units.velocityX[index] ?? 0, units.velocityY[index] ?? 0) /
            Math.max(0.001, stats.speed),
        );
        const momentum = stats.mass * (0.3 + speedShare * 0.9);
        pressureX[defenderSlot] = (pressureX[defenderSlot] ?? 0) + (dx / distance) * momentum;
        pressureY[defenderSlot] = (pressureY[defenderSlot] ?? 0) + (dy / distance) * momentum;
      }
    }

    if ((units.cooldown[index] ?? 0) > 0) continue;

    const damage = computeDamage(state, index, target, attackerGroup, defenderGroup);
    units.cooldown[index] = stats.cooldownTicks;

    recordEvent(state, index, {
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

  summariseContact(state);
  applyCombatPressure(state);
  compactGroups(state);
}

/** A stronger press physically yields ground instead of two lines ghosting together. */
function applyCombatPressure(state: GameState): void {
  for (let slot = 0; slot < state.groups.length; slot += 1) {
    const group = state.groups[slot];
    if (group === undefined || group.members.length === 0 || group.routing) continue;
    const x = pressureX[slot] ?? 0;
    const y = pressureY[slot] ?? 0;
    const magnitude = Math.hypot(x, y);
    if (magnitude < 0.001) continue;

    const stanceResistance =
      group.stance === 'hold_ground' ? 1.5 : group.stance === 'defensive' ? 1.2 : 1;
    const formationResistance =
      group.formation === 'square' ? 1.45 : group.formation === 'block' ? 1.15 : 1;
    const moraleResistance = 0.65 + group.morale * 0.0035;
    const yielded = Math.min(
      CONTACT.maximumYieldPerTick,
      (magnitude / Math.max(1, group.members.length)) *
        CONTACT.pressureScale /
        (stanceResistance * formationResistance * moraleResistance),
    );
    const nextX = group.anchor.x + (x / magnitude) * yielded;
    const nextY = group.anchor.y + (y / magnitude) * yielded;
    if (isPassable(nextX, nextY)) {
      group.anchor.x = nextX;
      group.anchor.y = nextY;
    }
  }
}

/**
 * Folds this tick's contact scratch back onto the group records.
 *
 * `engagement` tells `Movement` whether a formation is held in place, and
 * `encirclement` tells damage and morale how far round the body of men the
 * attack has come. Both are read on the following tick, which keeps the whole
 * thing a single pass over the army.
 */
function summariseContact(state: GameState): void {
  const span = Math.max(1, CONTACT.envelopedArcs - CONTACT.frontalArcs);

  for (let slot = 0; slot < state.groups.length; slot += 1) {
    const group = state.groups[slot];
    if (group === undefined) continue;

    const strength = group.members.length;
    if (strength === 0) {
      group.engagement = 0;
      group.encirclement = 0;
      continue;
    }

    group.engagement = Math.min(1, (contactCounts[slot] ?? 0) / strength);

    let arcs = 0;
    const base = slot * CONTACT.arcCount;
    for (let arc = 0; arc < CONTACT.arcCount; arc += 1) {
      const meaningfulContact = Math.max(MIN_ARC_CONTACT, Math.ceil(strength * 0.008));
      if ((arcCounts[base + arc] ?? 0) >= meaningfulContact) arcs += 1;
    }
    group.encirclement = Math.max(0, Math.min(1, (arcs - CONTACT.frontalArcs) / span));
  }
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
