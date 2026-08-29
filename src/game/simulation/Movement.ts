import {
  FORMATION_PROFILES,
  SLOT_ARRIVAL_RADIUS,
  STANCE_PROFILES,
  UNIT_STATS,
  WAYPOINT_ARRIVAL_RADIUS,
} from '../config/battle';
import type { ArmyGroup, Vector2D } from '../types/domain';
import { fillFormationSlots } from './Formations';
import { activeGroups, type GameState } from './GameState';
import { computePath } from './Navigation';
import { ZONES, isPassable } from './Zones';

/**
 * Movement.
 *
 * A group's anchor walks its waypoint list at the pace of its slowest member.
 * Every soldier steers toward an assigned formation slot relative to that
 * anchor. No unit ever runs a path search of its own.
 */

let slotBufferX = new Float32Array(2048);
let slotBufferY = new Float32Array(2048);

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
  for (const index of group.members) {
    const speed = UNIT_STATS[units.categoryOf(index)].speed;
    if (speed < slowest) slowest = speed;
  }
  if (!Number.isFinite(slowest)) return 0;
  return slowest * FORMATION_PROFILES[group.formation].speedModifier;
}

/** Routing groups abandon their orders and stream back toward their own rear. */
function routingDestination(group: ArmyGroup): Vector2D {
  const home = ZONES[group.ownerId === 'player' ? 'player_base' : 'enemy_base'];
  return { x: home.center.x, y: home.center.y };
}

function advanceAnchor(state: GameState, group: ArmyGroup): void {
  if (group.routing && group.path.length === 0) {
    group.path = computePath(group.anchor, routingDestination(group));
  }

  const waypoint = group.path[0];
  if (waypoint === undefined) return;

  const speed = groupSpeed(state, group);
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

  const stepX = (dx / remaining) * speed;
  const stepY = (dy / remaining) * speed;
  group.anchor.x += stepX;
  group.anchor.y += stepY;
  // Face the direction of march.
  group.facing = Math.atan2(dy, dx);
}

function advanceUnits(state: GameState, group: ArmyGroup): void {
  const units = state.units;
  const count = group.members.length;
  ensureSlotBuffers(count);
  fillFormationSlots(group.formation, count, group.anchor, group.facing, slotBufferX, slotBufferY);

  // How far from the group's anchor its men will chase a target.
  const leash = STANCE_PROFILES[group.stance].engagementRadius;

  for (let position = 0; position < count; position += 1) {
    const index = group.members[position];
    if (index === undefined || units.alive[index] !== 1) continue;

    const targetX = slotBufferX[position] ?? group.anchor.x;
    const targetY = slotBufferY[position] ?? group.anchor.y;
    units.slotX[index] = targetX;
    units.slotY[index] = targetY;

    const x = units.x[index] ?? 0;
    const y = units.y[index] ?? 0;

    let goalX = targetX;
    let goalY = targetY;

    // A unit that has found an enemy stands and fights when it can reach him,
    // and otherwise closes the last gap rather than standing in its slot
    // staring at a target ninety paces away. The stance sets the leash: men
    // holding ground stay dressed in line, aggressive troops charge out.
    const target = units.targetIdx[index] ?? -1;
    if (target >= 0 && units.alive[target] === 1) {
      const reach = UNIT_STATS[units.categoryOf(index)].range;
      const enemyX = units.x[target] ?? 0;
      const enemyY = units.y[target] ?? 0;
      const tdx = enemyX - x;
      const tdy = enemyY - y;
      if (tdx * tdx + tdy * tdy <= reach * reach) continue;

      const leashX = enemyX - group.anchor.x;
      const leashY = enemyY - group.anchor.y;
      if (leashX * leashX + leashY * leashY <= leash * leash) {
        goalX = enemyX;
        goalY = enemyY;
      }
    }

    const dx = goalX - x;
    const dy = goalY - y;
    const distance = Math.hypot(dx, dy);
    if (distance <= SLOT_ARRIVAL_RADIUS) continue;

    // Men lagging behind the formation hurry to catch up, which keeps a marching
    // column from smearing across the map.
    const base = UNIT_STATS[units.categoryOf(index)].speed;
    const speed = Math.min(distance, base * (distance > 240 ? 1.45 : 1));

    const nextX = x + (dx / distance) * speed;
    const nextY = y + (dy / distance) * speed;

    if (isPassable(nextX, nextY)) {
      units.x[index] = nextX;
      units.y[index] = nextY;
    } else if (isPassable(nextX, y)) {
      units.x[index] = nextX;
    } else if (isPassable(x, nextY)) {
      units.y[index] = nextY;
    }
  }
}

export function advanceMovement(state: GameState): void {
  for (const group of activeGroups(state)) {
    advanceAnchor(state, group);
    advanceUnits(state, group);
  }
}
