import {
  ACQUISITION_MARGIN,
  ACQUISITION_STRIDE,
  CONTACT,
  CROWDING,
  FATIGUE,
  FIRE,
  FORMATION_PROFILES,
  REACQUISITION_STRIDE,
  STANCE_PROFILES,
  UNIT_STATS,
  counterMultiplier,
  type UnitStats,
} from '../config/battle';
import { FACTION_ENEMY, FACTION_PLAYER, type ArmyGroup, type CombatEvent } from '../types/domain';
import type { GameState } from './GameState';
import { nextRandom } from './Random';
import { SpatialHash } from './SpatialHash';
import { UnitPool } from './UnitPool';
import { isInBarrier, isPassable, terrainAt } from './Zones';

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
/** Friendly neighbours counted this tick, and how many men were asked. */
let crowdSum = new Int32Array(64);
let crowdSamples = new Int32Array(64);
/** Charges delivered against a group this tick, before it is spread over its men. */
let shockImpulse = new Float32Array(64);
/** How masked this group's shots were, and how many it tried to take. */
let fireObstruction = new Float32Array(64);
let fireSamples = new Int32Array(64);
/** Damage is committed after every living unit has had its turn this tick. */
let pendingDamage = new Float32Array(10_000);

/** Minimum real body of troops that must press from one arc for it to count. */
const MIN_ARC_CONTACT = 4;

function ensureContactBuffers(groupCount: number): void {
  if (contactCounts.length >= groupCount) {
    contactCounts.fill(0, 0, groupCount);
    arcCounts.fill(0, 0, groupCount * CONTACT.arcCount);
    pressureX.fill(0, 0, groupCount);
    pressureY.fill(0, 0, groupCount);
    crowdSum.fill(0, 0, groupCount);
    crowdSamples.fill(0, 0, groupCount);
    shockImpulse.fill(0, 0, groupCount);
    fireObstruction.fill(0, 0, groupCount);
    fireSamples.fill(0, 0, groupCount);
    return;
  }
  let capacity = contactCounts.length;
  while (capacity < groupCount) capacity *= 2;
  contactCounts = new Int32Array(capacity);
  arcCounts = new Int32Array(capacity * CONTACT.arcCount);
  pressureX = new Float32Array(capacity);
  pressureY = new Float32Array(capacity);
  crowdSum = new Int32Array(capacity);
  crowdSamples = new Int32Array(capacity);
  shockImpulse = new Float32Array(capacity);
  fireObstruction = new Float32Array(capacity);
  fireSamples = new Int32Array(capacity);
}

function prepareDamageBuffer(capacity: number): void {
  if (pendingDamage.length < capacity) pendingDamage = new Float32Array(capacity);
  else pendingDamage.fill(0, 0, capacity);
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
 * Scratch for the one blow being resolved. Both are reset at the top of every
 * `computeDamage` call and read by its caller immediately afterwards, so
 * nothing survives the statement that produced it and two engines in one
 * process cannot interfere.
 *
 * They exist because whether a charge was actually delivered is decided deep
 * inside the damage calculation — it depends on the bearing, on what the
 * defender is braced in, and on whether the man still had a charge in hand —
 * and the caller is the one that has to spend it and record the shock.
 */
let chargeDelivered = false;
let chargeShock = 0;

/**
 * Getting a charge back.
 *
 * Men who have hit a line are in a melee from the next second onward, and no
 * amount of shoving turns that back into an impact. A body of horse recovers
 * its charge only by breaking clean off and getting up to pace again — which is
 * why cavalry parked in a fight is cavalry wasted, and why the ground behind
 * your own horse is worth keeping open.
 */
function reformCharge(units: UnitPool, index: number, stats: UnitStats): void {
  if (stats.chargePower <= 0 || units.chargeReady[index] === 1) return;
  const speed = Math.hypot(units.velocityX[index] ?? 0, units.velocityY[index] ?? 0);
  if (speed >= stats.speed * CONTACT.reformSpeedShare) units.chargeReady[index] = 1;
}

/**
 * How much of a missile regiment's own army is standing in the lane it is about
 * to shoot down, expressed as 0 for a clear field of fire and 1 for a lane it
 * cannot use at all.
 *
 * Lofting arms — a bow, an engine — clear most of what is in front of them, and
 * height clears more still, which is the second and larger reason a ridge is
 * worth taking: not the twelve percent a shot gains from above, but that a
 * battery on one can fire over its own army all day.
 */
function laneObstruction(
  state: GameState,
  shooter: number,
  target: number,
  stats: UnitStats,
  friendly: SpatialHash,
): number {
  const units = state.units;
  const x = units.x[shooter] ?? 0;
  const y = units.y[shooter] ?? 0;
  const targetX = units.x[target] ?? 0;
  const targetY = units.y[target] ?? 0;

  const blockers = friendly.weightedBlockersAlong(
    x,
    y,
    targetX,
    targetY,
    units,
    units.group[shooter] ?? -1,
  );
  if (blockers <= 0) return 0;

  let clearance = stats.loft;
  if (terrainAt(x, y) === 'hill' && terrainAt(targetX, targetY) !== 'hill') {
    clearance += FIRE.elevationRelief;
  }
  return Math.min(1, blockers / FIRE.saturation) * (1 - Math.min(0.95, clearance));
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
  chargeDelivered = false;
  chargeShock = 0;

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
    else if (attackerCategory === 'archer' || attackerCategory === 'handgunner') {
      // Bows and calivers both need clear files and room to loose together.
      // This makes the formation choice matter on both sides of a missile
      // exchange instead of affecting only how easy the regiment is to hit.
      damage *= FORMATION_PROFILES[attackerGroup.formation].rangedModifier;
    }
    // Men jammed shoulder to shoulder cannot use their weapons, and men who
    // have been fighting for a quarter of an hour swing short. Together these
    // stop one enormous mass of troops from being the answer to everything: it
    // arrives crushed, and it does not stay fresh.
    damage *= 1 - CROWDING.damagePenalty * attackerGroup.crowding;
    damage *= 1 - FATIGUE.damagePenalty * attackerGroup.fatigue;
  }

  if (defenderGroup !== undefined) {
    const profile = FORMATION_PROFILES[defenderGroup.formation];
    damage *= STANCE_PROFILES[defenderGroup.stance].damageTakenModifier;
    // A packed body of men is what archers and siege exist for: at that density
    // no shaft is wasted, which is what makes bombarding a column stalled on a
    // bridge the right answer to it.
    if (stats.range >= 100) {
      damage *=
        profile.rangedVulnerability *
        (1 + CROWDING.rangedVulnerability * defenderGroup.crowding);
    }
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
    //
    // It carries that shock exactly once. A charge is an arrival, not a state:
    // men who are already fighting cannot arrive again, and the impact only
    // comes back to a squadron that has broken clean off and got up to pace.
    if (
      stats.range < 100 &&
      stats.chargePower > 0 &&
      units.chargeReady[attacker] === 1
    ) {
      const velocity = Math.hypot(
        units.velocityX[attacker] ?? 0,
        units.velocityY[attacker] ?? 0,
      );
      const speedShare = Math.min(1, velocity / Math.max(0.001, stats.speed));
      const charge =
        Math.max(0, (speedShare - CONTACT.chargeSpeedShare) / (1 - CONTACT.chargeSpeedShare)) *
        Math.min(CONTACT.maximumChargeDamage, stats.chargePower);
      if (charge > 0) {
        const braced =
          offAxis <= CONTACT.frontArc &&
          defenderGroup.stance !== 'aggressive' &&
          (defenderGroup.formation === 'square' || defenderCategory === 'spearman');
        const delivered = charge * (braced ? 1 - CONTACT.braceReduction : 1);
        damage *= 1 + delivered;

        // What the impact does to the formation rather than to the men in it.
        // A charge taken in the rear is not merely a heavier blow: it is the
        // one nobody in the ranks saw coming.
        chargeDelivered = true;
        chargeShock =
          delivered *
          (offAxis > CONTACT.flankArc
            ? CONTACT.rearDamage
            : offAxis > CONTACT.frontArc
              ? CONTACT.flankDamage
              : 1);
      }
    }

    // Being attacked from every quarter at once. Ranks cannot close, there is
    // nowhere to give ground, and every man is fighting two.
    // Pressure rises sharply only once attacks cover most of the perimeter.
    // This keeps a broad frontal line from masquerading as a surround while a
    // genuine four-sided attack collapses the trapped formation decisively.
    damage *=
      1 +
      CONTACT.encirclementDamage *
        defenderGroup.encirclement *
        defenderGroup.encirclement;

    // Men who have already broken are being cut down, not fought.
    if (defenderGroup.routing) damage *= CONTACT.pursuitDamage;
  }

  // Fighting your way off a bridge. Men still on the crossing are strung out in
  // whatever order the defile allowed, against a line that is already formed;
  // this is the whole reason a crossing is worth holding rather than merely
  // worth walking over.
  if (
    isInBarrier(units.x[attacker] ?? 0, units.y[attacker] ?? 0) &&
    !isInBarrier(units.x[defender] ?? 0, units.y[defender] ?? 0)
  ) {
    damage *= CONTACT.assaultingCrossing;
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
function queueSplash(
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
        : FORMATION_PROFILES[victimGroup.formation].splashVulnerability *
          (1 + CROWDING.rangedVulnerability * victimGroup.crowding);
    // Falls off with distance so the centre of the blast is the worst place.
    const dx = (units.x[victim] ?? 0) - centerX;
    const dy = (units.y[victim] ?? 0) - centerY;
    const falloff = 1 - Math.min(1, Math.hypot(dx, dy) / radius);
    pendingDamage[victim] =
      (pendingDamage[victim] ?? 0) + baseDamage * 0.55 * falloff * vulnerability;
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
  prepareDamageBuffer(units.count);

  for (let index = 0; index < units.count; index += 1) {
    if (units.alive[index] !== 1) continue;

    const cooldown = units.cooldown[index] ?? 0;
    if (cooldown > 0) units.cooldown[index] = cooldown - 1;

    const category = units.categoryOf(index);
    const stats = UNIT_STATS[category];
    const x = units.x[index] ?? 0;
    const y = units.y[index] ?? 0;

    // How hard this man's own side is packed around him. Staggered by index so
    // only a cohort of the army pays for the search each tick, and taken before
    // the target logic below so men with nobody to fight still count.
    const ownSlot = units.group[index] ?? -1;
    if (ownSlot >= 0 && index % CROWDING.stride === state.currentTick % CROWDING.stride) {
      const friendly = units.owner[index] === FACTION_PLAYER ? playerHash : enemyHash;
      crowdSum[ownSlot] =
        (crowdSum[ownSlot] ?? 0) + friendly.countNear(x, y, CROWDING.radius, units, index);
      crowdSamples[ownSlot] = (crowdSamples[ownSlot] ?? 0) + 1;
    }

    // Surgeons carry nothing to fight with. They are still counted in the crowd
    // above, because a hospital jammed into a defile crushes the men around it
    // exactly as any other body of troops would, but from here on they take no
    // part: they acquire nobody, hold nobody, and shove nobody.
    if (stats.attack <= 0) continue;

    // A gun has to be unlimbered before it will fire, and putting it back on
    // its team throws that away. Every tick the piece is still rolling, the
    // wait starts again -- so artillery walked forward with the advance shoots
    // at nothing at all, and where a battery is placed is a decision made
    // several minutes before it pays.
    if (
      stats.deployTicks > 0 &&
      Math.hypot(units.velocityX[index] ?? 0, units.velocityY[index] ?? 0) >
        stats.speed * 0.2
    ) {
      units.cooldown[index] = stats.deployTicks;
      continue;
    }

    const stored = units.targetIdx[index] ?? -1;
    // A dead pool slot can be recycled by reinforcements. Its old pursuer must
    // never accept the new occupant blindly, especially when it now belongs to
    // the pursuer's own faction.
    const hasLiveTarget =
      stored >= 0 &&
      units.alive[stored] === 1 &&
      units.owner[stored] !== units.owner[index];
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

    // A man with nobody in reach is a man riding free, and that is the only
    // state in which a squadron gets its charge back.
    if (target < 0 || units.alive[target] !== 1) {
      reformCharge(units, index, stats);
      continue;
    }

    const dx = (units.x[target] ?? 0) - x;
    const dy = (units.y[target] ?? 0) - y;
    if (dx * dx + dy * dy > stats.range * stats.range) {
      reformCharge(units, index, stats);
      continue;
    }

    const attackerGroup = groupOf(state, index);
    const defenderGroup = groupOf(state, target);

    // A routed unit runs; it does not stop to trade blows, and it holds nobody
    // in place by standing there.
    if (attackerGroup?.routing === true) continue;

    // Physical contact is recorded for every melee fighter within reach, not
    // only for the men whose blow happens to land this tick. A regiment attacks
    // once every second or so, and sampling only those few strikes made the
    // picture of who was pressing where flicker far too much to steer on.
    // Men who have broken hold nobody in place, so chasing them does not pin
    // the pursuit. Without this exception cavalry sent after a rout were slowed
    // to a crawl by the very men they were riding down, and the rout escaped.
    const isMelee = stats.range < 100;
    const attackerSlot = units.group[index] ?? -1;
    if (isMelee && attackerSlot >= 0 && defenderGroup?.routing !== true) {
      contactCounts[attackerSlot] = (contactCounts[attackerSlot] ?? 0) + 1;
    }

    const defenderSlot = units.group[target] ?? -1;
    if (isMelee && defenderSlot >= 0 && defenderGroup !== undefined) {
      const arc = arcIndex(x - defenderGroup.anchor.x, y - defenderGroup.anchor.y);
      const bucket = defenderSlot * CONTACT.arcCount + arc;
      arcCounts[bucket] = (arcCounts[bucket] ?? 0) + 1;
    }

    if (defenderSlot >= 0 && isMelee) {
      const distance = Math.hypot(dx, dy);
      if (distance > 0.001) {
        const speedShare = Math.min(
          1,
          Math.hypot(units.velocityX[index] ?? 0, units.velocityY[index] ?? 0) /
            Math.max(0.001, stats.speed),
        );
        const momentum =
          stats.mass *
          (0.3 + speedShare * 0.9) *
          (isInBarrier(x, y) ? CONTACT.crossingPressure : 1);
        pressureX[defenderSlot] = (pressureX[defenderSlot] ?? 0) + (dx / distance) * momentum;
        pressureY[defenderSlot] = (pressureY[defenderSlot] ?? 0) + (dy / distance) * momentum;
      }
    }

    if ((units.cooldown[index] ?? 0) > 0) continue;

    // The line of fire. Before a missile arm looses, it finds out whether its
    // own army is standing in the lane. This is the term that makes where a
    // regiment of bows or a battery *stands* the whole decision about it:
    // behind the melee they are shooting into their own backs, on a flank or a
    // ridge they are shooting into the enemy.
    let obstruction = 0;
    if (!isMelee) {
      const friendly = units.owner[index] === FACTION_PLAYER ? playerHash : enemyHash;
      obstruction = laneObstruction(state, index, target, stats, friendly);
      if (attackerSlot >= 0) {
        fireObstruction[attackerSlot] = (fireObstruction[attackerSlot] ?? 0) + obstruction;
        fireSamples[attackerSlot] = (fireSamples[attackerSlot] ?? 0) + 1;
      }

      // A gun and a caliver are aimed along the barrel, so a masked lane is
      // simply a lane they will not use; the crew waits for it to clear rather
      // than firing into their own infantry. A bow or an engine throws its shot
      // high and takes the shot anyway, paying for it in accuracy above.
      if (stats.loft < FIRE.loftedTrajectory && obstruction >= FIRE.holdThreshold) {
        units.cooldown[index] = FIRE.holdTicks;
        continue;
      }
    }

    let damage = computeDamage(state, index, target, attackerGroup, defenderGroup);
    if (obstruction > 0) damage *= 1 - obstruction * FIRE.accuracyPenalty;
    units.cooldown[index] = stats.cooldownTicks;

    // The charge is spent by the blow that delivered it, and what it did to the
    // formation it landed on is carried to `Morale` through the group record.
    if (chargeDelivered) {
      units.chargeReady[index] = 0;
      if (defenderSlot >= 0) {
        shockImpulse[defenderSlot] = (shockImpulse[defenderSlot] ?? 0) + chargeShock;
      }
    }

    recordEvent(state, index, {
      x,
      y,
      targetX: units.x[target] ?? 0,
      targetY: units.y[target] ?? 0,
      kind: stats.splashRadius > 0 ? 'siege' : stats.range >= 100 ? 'arrow' : 'melee',
      tick: state.currentTick,
    });

    if (stats.splashRadius > 0) {
      queueSplash(state, index, target, damage, stats.splashRadius);
    }
    pendingDamage[target] = (pendingDamage[target] ?? 0) + damage;
  }

  // Resolve the round simultaneously. Previously low-index units could kill
  // their opponents before those opponents were visited, giving the faction
  // spawned first an invisible initiative advantage. Everyone alive at the
  // start of this combat pass now gets the blow they earned.
  for (let index = 0; index < units.count; index += 1) {
    const damage = pendingDamage[index] ?? 0;
    if (damage > 0 && units.alive[index] === 1) applyDamage(state, index, damage);
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
    // Exhausted men keep their feet less well than fresh ones.
    const enduranceResistance = 1 - FATIGUE.yieldPenalty * group.fatigue;
    const yielded = Math.min(
      CONTACT.maximumYieldPerTick,
      (magnitude / Math.max(1, group.members.length)) *
        CONTACT.pressureScale /
        (stanceResistance * formationResistance * moraleResistance * enduranceResistance),
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
      group.crowding = 0;
      group.shock = 0;
      group.blockedFire = 0;
      continue;
    }

    // What a charge did to the formation, spread over the men who have to
    // absorb it and decaying over the few seconds a shaken line has to steady
    // itself in. A second squadron arriving inside that window compounds with
    // the first, which is what makes charges worth timing together.
    group.shock = Math.min(
      1,
      group.shock * CONTACT.shockDecay +
        ((shockImpulse[slot] ?? 0) / strength) * CONTACT.shockScale,
    );

    // Whether this regiment can see what it is shooting at. Smoothed over the
    // shots it actually takes, because the lane in front of a battery opens and
    // closes constantly in a moving battle and a badge that flickered every
    // second would be unreadable. A tick carrying no shot is not evidence of a
    // clear lane — for a masked regiment it is the opposite — so it only fades
    // the reading rather than answering it.
    const shots = fireSamples[slot] ?? 0;
    if (shots > 0) {
      const measuredFire = (fireObstruction[slot] ?? 0) / shots;
      group.blockedFire += (measuredFire - group.blockedFire) * FIRE.smoothing;
    } else {
      group.blockedFire *= FIRE.idleDecay;
    }

    // Smoothed, because one tick's sample of a moving formation jitters far too
    // much to hang a damage multiplier on.
    const samples = crowdSamples[slot] ?? 0;
    if (samples > 0) {
      const density = (crowdSum[slot] ?? 0) / samples;
      const span = Math.max(1, CROWDING.crushed - CROWDING.comfortable);
      const measured = Math.max(0, Math.min(1, (density - CROWDING.comfortable) / span));
      group.crowding += (measured - group.crowding) * CROWDING.smoothing;
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

