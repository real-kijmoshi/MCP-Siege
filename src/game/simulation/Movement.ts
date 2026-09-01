import {
  CONTACT,
  FORMATION_PROFILES,
  PHYSICS,
  SLOT_ARRIVAL_RADIUS,
  STANCE_PROFILES,
  UNIT_STATS,
  WAYPOINT_ARRIVAL_RADIUS,
  terrainSpeedModifier,
} from '../config/battle';
import { FACTION_ENEMY, FACTION_PLAYER, type ArmyGroup, type Vector2D } from '../types/domain';
import { fillFormationSlots, formationRadius } from './Formations';
import type { GameState } from './GameState';
import { computePath } from './Navigation';
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
  return 1 - pinned * (1 - CONTACT.pinnedSpeed);
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

/** Friendly regiments queue and flow around each other instead of stacking anchors. */
function steerAroundGroups(
  state: GameState,
  group: ArmyGroup,
  slot: number,
  direction: Vector2D,
): void {
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
      direction.x += (slot < otherSlot ? -1 : 1) * overlap;
    } else {
      direction.x += (dx / distance) * overlap * 0.9;
      direction.y += (dy / distance) * overlap * 0.9;
    }
  }
}

function advanceAnchor(state: GameState, group: ArmyGroup, slot: number): void {
  if (group.routing && group.path.length === 0) {
    const clearance = Math.min(75, formationRadius(group.formation, group.members.length) * 0.16);
    group.path = computePath(group.anchor, routingDestination(group), clearance);
  }

  const waypoint = group.path[0];
  if (waypoint === undefined) return;

  const speed = groupSpeed(state, group) * contactSpeedFactor(group);
  if (speed <= 0) return;

  const dx = waypoint.x - group.anchor.x;
  const dy = waypoint.y - group.anchor.y;
  const remaining = Math.hypot(dx, dy);

  if (remaining <= Math.max(WAYPOINT_ARRIVAL_RADIUS, speed)) {
    group.anchor.x = waypoint.x;
    group.anchor.y = waypoint.y;
    group.path.shift();
    if (group.path.length === 0 && !group.routing) {
      // Arrived. A move settles into holding; attack and defend orders persist
      // so the combat and morale systems keep treating the group as committed.
      if (group.order.kind === 'move' || group.order.kind === 'scout') {
        group.order = { kind: 'hold', issuedAtTick: state.currentTick };
      }
    }
    return;
  }

  const direction = directionScratch;
  direction.x = dx / remaining;
  direction.y = dy / remaining;
  steerAroundGroups(state, group, slot, direction);
  const directionLength = Math.hypot(direction.x, direction.y) || 1;
  const stepX = (direction.x / directionLength) * speed;
  const stepY = (direction.y / directionLength) * speed;
  const nextX = group.anchor.x + stepX;
  const nextY = group.anchor.y + stepY;
  if (isPassable(nextX, nextY)) {
    group.anchor.x = nextX;
    group.anchor.y = nextY;
  }
  // Large formations wheel rather than snapping instantly onto a new heading.
  const desiredFacing = Math.atan2(dy, dx);
  const turnRate = PHYSICS.groupTurnRate * Math.max(0.55, FORMATION_PROFILES[group.formation].speedModifier);
  group.facing = turnTowards(group.facing, desiredFacing, turnRate);
}

function advanceUnits(state: GameState, group: ArmyGroup): void {
  const units = state.units;
  const count = group.members.length;
  ensureSlotBuffers(count);
  fillFormationSlots(group.formation, count, group.anchor, group.facing, slotBufferX, slotBufferY);

  // How far from the group's anchor its men will chase a target.
  const leash = STANCE_PROFILES[group.stance].engagementRadius;
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
    if (target >= 0 && units.alive[target] === 1) {
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

    const nextX = x + velocityX;
    const nextY = y + velocityY;

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
    advanceAnchor(state, group, slot);
    advanceUnits(state, group);
  }
}
