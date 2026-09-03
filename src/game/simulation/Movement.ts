import {
  COMMAND_AUTHORITY,
  CONTACT,
  FORMATION_PROFILES,
  PHYSICS,
  SLOT_ARRIVAL_RADIUS,
  STANCE_PROFILES,
  UNIT_STATS,
  TICKS_PER_SECOND,
  WAYPOINT_ARRIVAL_RADIUS,
  terrainSpeedModifier,
} from '../config/battle';
import { FACTION_ENEMY, FACTION_PLAYER, type ArmyGroup, type Vector2D } from '../types/domain';
import { fillFormationSlots, marchClearance } from './Formations';
import type { GameState } from './GameState';
import { computePath, hasClearLineOfMarch } from './Navigation';
import { SpatialHash } from './SpatialHash';
import { homeZoneOf, isPassable, terrainAt } from './Zones';

/**
 * Movement.
 *
 * A group's anchor walks its waypoint list at the pace of its slowest member.
 * Every soldier steers toward an assigned formation slot relative to that
 * anchor. No unit ever runs a path search of its own.
 */

let slotBufferX = new Float32Array(2048);
let slotBufferY = new Float32Array(2048);
const movementHashes = [new SpatialHash(10_000), new SpatialHash(10_000)];
const separation = new Float32Array(2);
const directionScratch: Vector2D = { x: 0, y: 0 };
/** target bearing x/y sums, acquired targets, ranged members, ranged firing */
const engagementAssessment = new Float64Array(5);

function ensureSlotBuffers(size: number): void {
  if (slotBufferX.length >= size) return;
  let capacity = slotBufferX.length;
  while (capacity < size) capacity *= 2;
  slotBufferX = new Float32Array(capacity);
  slotBufferY = new Float32Array(capacity);
}

/** The pace of the slowest man in the formation. */
function groupSpeed(state: GameState, group: ArmyGroup): number {
  const units = state.units;
  let slowest = Number.POSITIVE_INFINITY;
  const terrain = terrainAt(group.anchor.x, group.anchor.y);
  for (const index of group.members) {
    const category = units.categoryOf(index);
    const speed = UNIT_STATS[category].speed * terrainSpeedModifier(category, terrain);
    if (speed < slowest) slowest = speed;
  }
  if (!Number.isFinite(slowest)) return 0;
  return slowest * FORMATION_PROFILES[group.formation].speedModifier;
}

/**
 * How much of its march a formation keeps while it is in contact.
 *
 * A body of men fighting to its front cannot simply keep walking: it has to
 * beat what is in front of it first. Without this a column crossed a bridge
 * held by three regiments at full pace and came out the far side, which made
 * blocking positions — the whole point of holding a crossing — worthless.
 * Troops already broken are exempt: running away is precisely what they are
 * doing, and so is a formation under an explicit order to withdraw.
 */
function contactSpeedFactor(group: ArmyGroup): number {
  if (group.routing || group.order.kind === 'retreat') return 1;
  const pinned = Math.min(1, group.engagement / CONTACT.pinEngagement);
  const committedAttack =
    (group.order.kind === 'attack_zone' || group.order.kind === 'attack_group') &&
    group.stance === 'aggressive' &&
    (engagementAssessment[3] ?? 0) * 2 < group.members.length &&
    group.morale >= COMMAND_AUTHORITY.committedAttackMorale;
  // An attack backed by enough command authority is a push by the regiment,
  // not a private chase by whichever front-rank men acquired targets first.
  // Keep the anchor advancing through contact so every rank's formation slot
  // follows the assault. Shaken formations still stall and yield normally.
  const pinnedSpeed = committedAttack
    ? COMMAND_AUTHORITY.committedAttackPinnedSpeed
    : CONTACT.pinnedSpeed;
  return 1 - pinned * (1 - pinnedSpeed);
}

/**
 * Reads the targets acquired by `Combat` on the previous tick.
 *
 * The scan is group-local and allocation-free. It lets the regiment behave as
 * one body: a missile formation can stop its anchor when its front rank opens
 * fire, and a stationary or pinned formation can dress toward the fight rather
 * than leaving every soldier to peel away from a stale facing.
 */
function assessEngagement(state: GameState, group: ArmyGroup): void {
  engagementAssessment.fill(0);
  const units = state.units;

  for (const index of group.members) {
    if (units.alive[index] !== 1) continue;
    const stats = UNIT_STATS[units.categoryOf(index)];
    if (stats.range >= 100) {
      engagementAssessment[3] = (engagementAssessment[3] ?? 0) + 1;
    }

    const target = units.targetIdx[index] ?? -1;
    if (target < 0 || units.alive[target] !== 1) continue;
    const groupDx = (units.x[target] ?? 0) - group.anchor.x;
    const groupDy = (units.y[target] ?? 0) - group.anchor.y;
    const groupDistance = Math.hypot(groupDx, groupDy);
    if (groupDistance > 0.001) {
      engagementAssessment[0] = (engagementAssessment[0] ?? 0) + groupDx / groupDistance;
      engagementAssessment[1] = (engagementAssessment[1] ?? 0) + groupDy / groupDistance;
    }
    engagementAssessment[2] = (engagementAssessment[2] ?? 0) + 1;

    if (stats.range >= 100) {
      const dx = (units.x[target] ?? 0) - (units.x[index] ?? 0);
      const dy = (units.y[target] ?? 0) - (units.y[index] ?? 0);
      if (dx * dx + dy * dy <= stats.range * stats.range) {
        engagementAssessment[4] = (engagementAssessment[4] ?? 0) + 1;
      }
    }
  }
}

/**
 * Missile-led regiments halt an assault to fire, but an explicit move keeps
 * moving, and a regiment standing on a crossing never halts at all: a bridge
 * or ford is ground you have to get off, not ground you fight from, and a
 * stopped regiment there wedges the whole column against the bank behind it.
 */
function shouldHaltForVolley(group: ArmyGroup): boolean {
  if (
    group.routing ||
    group.order.kind === 'retreat' ||
    group.order.kind === 'move' ||
    group.order.kind === 'scout'
  ) {
    return false;
  }
  if (terrainAt(group.anchor.x, group.anchor.y) === 'crossing') return false;
  const ranged = engagementAssessment[3] ?? 0;
  const firing = engagementAssessment[4] ?? 0;
  return ranged * 2 >= group.members.length && firing >= Math.max(1, Math.ceil(ranged * 0.02));
}

/** Routing groups abandon their orders and stream back toward their own rear. */
function routingDestination(group: ArmyGroup): Vector2D {
  const home = homeZoneOf(group.ownerId);
  return { x: home.center.x, y: home.center.y };
}

function turnTowards(current: number, desired: number, maximum: number): number {
  let delta = desired - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + Math.max(-maximum, Math.min(maximum, delta));
}

/**
 * How far the press of friendly regiments may deflect a march.
 *
 * The steering direction it is added to is a unit vector, so a cap below one
 * guarantees the waypoint still decides where the group is going. Uncapped, the
 * avoidance of three or four crowded neighbours simply outvoted the order: a
 * column shouldered its way sideways off the line it had been routed along,
 * and because the route was a straight line threaded onto a bridge, it arrived
 * at the river a few hundred paces downstream of the crossing and jammed
 * against the bank for the rest of the battle.
 */
const MAX_AVOIDANCE = 0.7;

/** Friendly regiments queue and flow around each other instead of stacking anchors. */
function steerAroundGroups(
  state: GameState,
  group: ArmyGroup,
  slot: number,
  direction: Vector2D,
): void {
  let pushX = 0;
  let pushY = 0;
  for (let otherSlot = 0; otherSlot < state.groups.length; otherSlot += 1) {
    const other = state.groups[otherSlot];
    if (
      other === undefined ||
      otherSlot === slot ||
      other.ownerId !== group.ownerId ||
      other.members.length === 0
    ) {
      continue;
    }
    const dx = group.anchor.x - other.anchor.x;
    const dy = group.anchor.y - other.anchor.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared >= PHYSICS.groupPersonalSpace * PHYSICS.groupPersonalSpace) continue;
    const distance = Math.sqrt(Math.max(0.001, distanceSquared));
    const overlap = 1 - distance / PHYSICS.groupPersonalSpace;
    if (distanceSquared < 0.001) {
      // Exactly co-located: break the tie on slot order, and along both axes,
      // so two stacked anchors actually separate instead of sliding down one.
      const sign = slot < otherSlot ? -1 : 1;
      pushX += sign * overlap * Math.SQRT1_2;
      pushY += sign * overlap * Math.SQRT1_2;
    } else {
      pushX += (dx / distance) * overlap * 0.9;
      pushY += (dy / distance) * overlap * 0.9;
    }
  }

  const push = Math.hypot(pushX, pushY);
  if (push <= 0) return;
  const scale = push > MAX_AVOIDANCE ? MAX_AVOIDANCE / push : 1;
  direction.x += pushX * scale;
  direction.y += pushY * scale;
}

/* ------------------------------------------------------------- re-routing */

/*
 * A route is planned once, from where the group stood when it was ordered, and
 * that was the whole of navigation. It was not enough. A regiment is shoved
 * about by the friendly regiments around it, so the line it was given and the
 * ground it actually walks come apart, and once they have the plan is worse
 * than useless: a leg threaded onto a bridge, walked from a hundred paces to
 * one side, runs into the bank instead. The anchor then stopped dead there for
 * the rest of the battle, because nothing ever asked the question again.
 *
 * So a marching group audits the leg it is on and re-routes when it no longer
 * holds. The checks are staggered and rate-limited: this is recovery from a
 * plan that has gone stale, not a path search per tick.
 */

/** Ticks of no useful progress before a marching group re-routes itself. */
const STALL_REPLAN_TICKS = TICKS_PER_SECOND * 2;

/** Shortest interval between two automatic re-routes of one group. */
const REPLAN_COOLDOWN_TICKS = TICKS_PER_SECOND * 3;

/** How often a group re-checks that its current leg still runs over open ground. */
const LEG_AUDIT_INTERVAL = TICKS_PER_SECOND;

/** Share of the intended step that counts as having got somewhere. */
const PROGRESS_FRACTION = 0.2;

/**
 * Re-routes the leg a group is on, keeping whatever was queued behind it.
 *
 * Only the current leg is replanned. The waypoints after it are the rest of an
 * order somebody actually gave — an appended march, a deliberate detour — and
 * re-planning straight to the last of them would quietly discard the route that
 * was chosen. Returns whether a search was run, so a caller can leave the stall
 * counter alone when the cooldown refused.
 */
function replanCurrentLeg(state: GameState, group: ArmyGroup): boolean {
  if (state.currentTick - group.lastReplanTick < REPLAN_COOLDOWN_TICKS) return false;
  const waypoint = group.path[0];
  if (waypoint === undefined) return false;

  group.lastReplanTick = state.currentTick;
  const clearance = marchClearance(group.formation, group.members.length);
  const legs = computePath(group.anchor, waypoint, clearance);
  // `computePath` always yields at least the destination, so the leg is never
  // lost; at worst the group is handed back the line it already had and tries
  // again once the cooldown has run out.
  group.path.splice(0, 1, ...legs);
  return true;
}

function advanceAnchor(
  state: GameState,
  group: ArmyGroup,
  slot: number,
  haltForVolley: boolean,
): void {
  if (group.routing && group.path.length === 0) {
    const clearance = marchClearance(group.formation, group.members.length);
    group.path = computePath(group.anchor, routingDestination(group), clearance);
  }

  const waypoint = group.path[0];
  if (waypoint === undefined) {
    group.stallTicks = 0;
    return;
  }

  if (haltForVolley) {
    group.stallTicks = 0;
    return;
  }

  const speed = groupSpeed(state, group) * contactSpeedFactor(group);
  if (speed <= 0) return;

  const dx = waypoint.x - group.anchor.x;
  const dy = waypoint.y - group.anchor.y;
  const remaining = Math.hypot(dx, dy);

  if (remaining <= Math.max(WAYPOINT_ARRIVAL_RADIUS, speed)) {
    group.anchor.x = waypoint.x;
    group.anchor.y = waypoint.y;
    group.path.shift();
    group.stallTicks = 0;
    if (group.path.length === 0 && !group.routing) {
      // Arrived. A move settles into holding; attack and defend orders persist
      // so the combat and morale systems keep treating the group as committed.
      if (group.order.kind === 'move' || group.order.kind === 'scout') {
        group.order = { kind: 'hold', issuedAtTick: state.currentTick };
      }
    }
    return;
  }

  const startX = group.anchor.x;
  const startY = group.anchor.y;

  const direction = directionScratch;
  direction.x = dx / remaining;
  direction.y = dy / remaining;
  steerAroundGroups(state, group, slot, direction);
  const directionLength = Math.hypot(direction.x, direction.y) || 1;
  const stepX = (direction.x / directionLength) * speed;
  const stepY = (direction.y / directionLength) * speed;
  const nextX = startX + stepX;
  const nextY = startY + stepY;
  if (isPassable(nextX, nextY)) {
    group.anchor.x = nextX;
    group.anchor.y = nextY;
  } else if (isPassable(nextX, startY)) {
    // Sliding along an obstacle rather than stopping dead against it keeps a
    // column that has clipped a bank moving while the re-route is arranged.
    group.anchor.x = nextX;
  } else if (isPassable(startX, nextY)) {
    group.anchor.y = nextY;
  }

  // Progress is measured along the line to the waypoint rather than as raw
  // movement: a group being walked sideways by the press around it travels at
  // full pace and arrives nowhere, and that is exactly a stall.
  const advanced =
    (group.anchor.x - startX) * (dx / remaining) + (group.anchor.y - startY) * (dy / remaining);
  if (advanced < speed * PROGRESS_FRACTION) group.stallTicks += 1;
  else group.stallTicks = 0;

  // Two independent reasons to ask for a new route: the group has stopped
  // getting anywhere, or the leg it is on no longer runs over walkable ground.
  // The audit is staggered on the group's own slot, so the whole army never
  // samples its legs on the same tick.
  const audit =
    (state.currentTick + slot) % LEG_AUDIT_INTERVAL === 0 &&
    !hasClearLineOfMarch(group.anchor, waypoint, 0);
  if ((group.stallTicks >= STALL_REPLAN_TICKS || audit) && replanCurrentLeg(state, group)) {
    group.stallTicks = 0;
  }

  // Large formations wheel rather than snapping instantly onto a new heading.
  const desiredFacing = Math.atan2(dy, dx);
  const turnRate = PHYSICS.groupTurnRate * Math.max(0.55, FORMATION_PROFILES[group.formation].speedModifier);
  group.facing = turnTowards(group.facing, desiredFacing, turnRate);
}

/** A halted missile formation wheels toward the enemy it is actually firing on. */
function faceEngagement(group: ArmyGroup, haltForVolley: boolean): void {
  const targets = engagementAssessment[2] ?? 0;
  // Melee slots already flow into contact and are highly sensitive to a wheel
  // during the press. Turn only a regiment that has deliberately halted for a
  // volley; the line then changes front without dragging a melee ring apart.
  if (targets <= 0 || !haltForVolley) return;

  const dx = engagementAssessment[0] ?? 0;
  const dy = engagementAssessment[1] ?? 0;
  // Threats spread round the regiment have no single front. Refusing to wheel
  // toward a tiny numerical imbalance keeps an encircled body from endlessly
  // rotating its slots and opening artificial gaps in the ring.
  if (Math.hypot(dx, dy) / targets < 0.35) return;
  const turnRate =
    PHYSICS.groupTurnRate * Math.max(0.55, FORMATION_PROFILES[group.formation].speedModifier);
  group.facing = turnTowards(group.facing, Math.atan2(dy, dx), turnRate);
}

function advanceUnits(state: GameState, group: ArmyGroup): void {
  const units = state.units;
  const count = group.members.length;
  ensureSlotBuffers(count);
  fillFormationSlots(group.formation, count, group.anchor, group.facing, slotBufferX, slotBufferY);

  // How far from the group's anchor its men will chase a target.
  const orderedLeash = STANCE_PROFILES[group.stance].engagementRadius;
  const terrain = terrainAt(group.anchor.x, group.anchor.y);
  const playerHash = movementHashes[FACTION_PLAYER];
  const enemyHash = movementHashes[FACTION_ENEMY];

  for (let position = 0; position < count; position += 1) {
    const index = group.members[position];
    if (index === undefined || units.alive[index] !== 1) continue;

    const targetX = slotBufferX[position] ?? group.anchor.x;
    const targetY = slotBufferY[position] ?? group.anchor.y;
    // A wide formation cannot physically fit on a bridge or through a defile.
    // Compress only the blocked files onto the passable group anchor while it
    // crosses, then let them dress back into formation on the far side.
    const targetPassable = isPassable(targetX, targetY);
    units.slotX[index] = targetPassable ? targetX : group.anchor.x;
    units.slotY[index] = targetPassable ? targetY : group.anchor.y;

    const x = units.x[index] ?? 0;
    const y = units.y[index] ?? 0;

    let goalX = targetX;
    let goalY = targetY;

    // A unit that has found an enemy brakes and fights when it can reach him,
    // and otherwise closes the last gap rather than standing in its slot
    // staring at a target ninety paces away. The stance sets the leash: men
    // holding ground stay dressed in line, aggressive troops charge out.
    const target = group.routing ? -1 : units.targetIdx[index] ?? -1;
    if (
      target >= 0 &&
      units.alive[target] === 1 &&
      units.owner[target] !== units.owner[index]
    ) {
      const reach = UNIT_STATS[units.categoryOf(index)].range;
      const enemyX = units.x[target] ?? 0;
      const enemyY = units.y[target] ?? 0;
      const tdx = enemyX - x;
      const tdy = enemyY - y;
      if (tdx * tdx + tdy * tdy <= reach * reach) {
        goalX = x;
        goalY = y;
      }

      const leashX = enemyX - group.anchor.x;
      const leashY = enemyY - group.anchor.y;
      const targetSlot = units.group[target] ?? -1;
      const targetGroup = targetSlot >= 0 ? state.groups[targetSlot] : undefined;
      const targetSurvival =
        targetGroup === undefined
          ? 1
          : targetGroup.members.length / Math.max(1, targetGroup.initialStrength);
      // Morale is command authority made concrete. Confident troops keep the
      // exact leash they were ordered; shaken troops increasingly trust their
      // instinct and run after an enemy that looks ready to collapse.
      const authority = Math.max(0, Math.min(1, group.morale / 100));
      const vulnerability = Math.max(
        0,
        1 - targetSurvival / COMMAND_AUTHORITY.vulnerableEnemyStrength,
      );
      const leash =
        orderedLeash +
        COMMAND_AUTHORITY.maximumExtraLeash * (1 - authority) * vulnerability;
      if (
        tdx * tdx + tdy * tdy > reach * reach &&
        leashX * leashX + leashY * leashY <= leash * leash
      ) {
        goalX = enemyX;
        goalY = enemyY;
      }
    }

    const dx = goalX - x;
    const dy = goalY - y;
    const distance = Math.hypot(dx, dy);
    const category = units.categoryOf(index);
    const stats = UNIT_STATS[category];
    const base = stats.speed * terrainSpeedModifier(category, terrain);
    const catchup = distance > 240 ? 1.45 : distance > 100 ? 1.18 : 1;
    let desiredVelocityX = 0;
    let desiredVelocityY = 0;
    if (distance > SLOT_ARRIVAL_RADIUS) {
      const desiredSpeed = Math.min(distance, base * catchup);
      desiredVelocityX = (dx / distance) * desiredSpeed;
      desiredVelocityY = (dy / distance) * desiredSpeed;
    }

    let velocityX = units.velocityX[index] ?? 0;
    let velocityY = units.velocityY[index] ?? 0;
    velocityX += (desiredVelocityX - velocityX) * stats.acceleration;
    velocityY += (desiredVelocityY - velocityY) * stats.acceleration;
    if (desiredVelocityX === 0 && desiredVelocityY === 0) {
      velocityX *= PHYSICS.idleDamping;
      velocityY *= PHYSICS.idleDamping;
    }

    // Local body avoidance keeps ranks from collapsing into a single point.
    // Both faction hashes are sampled so opposing lines physically meet rather
    // than walking through one another between attack checks.
    if (index % PHYSICS.separationStride === state.currentTick % PHYSICS.separationStride) {
      separation[0] = 0;
      separation[1] = 0;
      playerHash?.accumulateSeparation(x, y, stats.bodyRadius, units, index, separation);
      enemyHash?.accumulateSeparation(x, y, stats.bodyRadius, units, index, separation);
      velocityX += (separation[0] ?? 0) * base * PHYSICS.separationStrength;
      velocityY += (separation[1] ?? 0) * base * PHYSICS.separationStrength;
    }

    const velocity = Math.hypot(velocityX, velocityY);
    const maximum = base * catchup;
    if (velocity > maximum && velocity > 0) {
      velocityX = (velocityX / velocity) * maximum;
      velocityY = (velocityY / velocity) * maximum;
    }

    // Rounded to what the pool will actually store. Positions live in
    // `Float32Array`, so testing the wider intermediate let a man wedged
    // exactly on the lip of a bridge pass the check and then be written a few
    // ten-thousandths the other side of it, into the river.
    const nextX = Math.fround(x + velocityX);
    const nextY = Math.fround(y + velocityY);

    if (isPassable(nextX, nextY)) {
      units.x[index] = nextX;
      units.y[index] = nextY;
    } else if (isPassable(nextX, y)) {
      units.x[index] = nextX;
      velocityY = 0;
    } else if (isPassable(x, nextY)) {
      units.y[index] = nextY;
      velocityX = 0;
    } else {
      velocityX = 0;
      velocityY = 0;
    }
    units.velocityX[index] = velocityX;
    units.velocityY[index] = velocityY;
  }
}

export function advanceMovement(state: GameState): void {
  movementHashes[FACTION_PLAYER]?.build(state.units, FACTION_PLAYER);
  movementHashes[FACTION_ENEMY]?.build(state.units, FACTION_ENEMY);
  for (let slot = 0; slot < state.groups.length; slot += 1) {
    const group = state.groups[slot];
    if (group === undefined || group.members.length === 0) continue;
    assessEngagement(state, group);
    const haltForVolley = shouldHaltForVolley(group);
    advanceAnchor(state, group, slot, haltForVolley);
    faceEngagement(group, haltForVolley);
    advanceUnits(state, group);
  }
}

