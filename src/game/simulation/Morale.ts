import { MORALE, MORALE_THRESHOLDS } from '../config/battle';
import type { ArmyGroup, MoraleState } from '../types/domain';
import { activeGroups, type GameState } from './GameState';
import { isDefensiveTerrain } from './Zones';

/**
 * Morale.
 *
 * Cheap to run because it works on the ~18 group records rather than on
 * individual soldiers, yet it produces most of the tactical texture: lines that
 * bend, flanks that collapse, and reserves that are worth committing.
 */

export function moraleStateOf(morale: number): MoraleState {
  if (morale >= MORALE_THRESHOLDS.confident) return 'confident';
  if (morale >= MORALE_THRESHOLDS.stable) return 'stable';
  if (morale >= MORALE_THRESHOLDS.shaken) return 'shaken';
  if (morale >= MORALE_THRESHOLDS.breaking) return 'breaking';
  return 'routing';
}

/** Enemies bearing on the group from widely separated angles count as a flank. */
function isFlanked(group: ArmyGroup, others: readonly ArmyGroup[]): boolean {
  const bearings: number[] = [];
  for (const other of others) {
    if (other.ownerId === group.ownerId || other.members.length === 0) continue;
    const dx = other.anchor.x - group.anchor.x;
    const dy = other.anchor.y - group.anchor.y;
    if (dx * dx + dy * dy > 700 * 700) continue;
    bearings.push(Math.atan2(dy, dx));
  }
  if (bearings.length < 2) return false;

  for (let a = 0; a < bearings.length; a += 1) {
    for (let b = a + 1; b < bearings.length; b += 1) {
      const first = bearings[a] ?? 0;
      const second = bearings[b] ?? 0;
      let spread = Math.abs(first - second);
      if (spread > Math.PI) spread = Math.PI * 2 - spread;
      if (spread > Math.PI / 2) return true;
    }
  }
  return false;
}

export function advanceMorale(state: GameState): void {
  const groups = activeGroups(state);

  for (const group of groups) {
    group.recentCasualties *= MORALE.casualtyDecay;

    const strength = Math.max(1, group.members.length);
    let delta = 0;

    // Losses are the dominant term, measured as a share of remaining strength
    // so a small detachment feels the same twenty casualties far more sharply.
    const pressure = group.recentCasualties / strength;
    delta -= pressure * MORALE.casualtyPenalty;

    // Out of contact, a group steadies. A broken one rallies faster, which is
    // what lets a routed army come back into the battle rather than deleting
    // itself; without this, neighbouring routs feed each other into a spiral
    // that no side ever recovers from.
    if (pressure < 0.002) {
      delta += group.routing ? MORALE.rallyRecoveryPerTick : MORALE.recoveryPerTick;
    }

    let supported = false;
    let routingNeighbour = false;
    for (const other of groups) {
      if (other === group || other.ownerId !== group.ownerId) continue;
      const dx = other.anchor.x - group.anchor.x;
      const dy = other.anchor.y - group.anchor.y;
      if (dx * dx + dy * dy > MORALE.supportRadius * MORALE.supportRadius) continue;
      if (other.routing) routingNeighbour = true;
      else supported = true;
    }
    if (supported) delta += MORALE.supportPerTick;

    // Seeing a formation break is unnerving once, not once per neighbour, and
    // it means nothing to men who are already running.
    if (routingNeighbour && !group.routing) delta -= MORALE.nearbyRoutPenalty;

    // Men in flight are not holding a flank, so neither penalty applies.
    if (!group.routing) {
      if (isFlanked(group, groups)) delta -= MORALE.flankedPenalty;
      if (isDefensiveTerrain(group.anchor.x, group.anchor.y)) delta += MORALE.terrainBonus;
    }

    group.morale = Math.max(0, Math.min(100, group.morale + delta));
    group.moraleState = moraleStateOf(group.morale);

    if (!group.routing && group.moraleState === 'routing') {
      // The group breaks: it drops its orders and streams for the rear.
      group.routing = true;
      group.path = [];
      group.order = { kind: 'retreat', issuedAtTick: state.currentTick };
    } else if (group.routing && group.morale >= MORALE.rallyThreshold) {
      group.routing = false;
      group.path = [];
      group.order = { kind: 'hold', issuedAtTick: state.currentTick };
    }
  }
}
