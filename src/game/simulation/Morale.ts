import {
  CROWDING,
  FATIGUE,
  FIELD_SUPPORT,
  MORALE,
  MORALE_THRESHOLDS,
  OBJECTIVE,
} from '../config/battle';
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

/**
 * Enemy formations closing from widely separated angles.
 *
 * This is the threat of being flanked rather than the fact of it: it reads
 * anchors, so it fires while the enveloping regiments are still on their way.
 * What actually happens once they arrive is `group.encirclement`, measured by
 * `Combat` from the arcs blows arrive on, and that carries the heavier penalty.
 */
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
      // Spent men steady more slowly than fresh ones, so a regiment pulled out
      // of a long fight cannot simply be fed straight back into it.
      const rest = group.routing ? MORALE.rallyRecoveryPerTick : MORALE.recoveryPerTick;
      delta += rest * (1 - FATIGUE.recoveryDrag * group.fatigue);
      // Being looked after steadies men on its own, over and above the rest it
      // buys them. `FieldSupport` has already zeroed care for anybody still in
      // contact, so this can never reward a regiment for staying in the line.
      delta += FIELD_SUPPORT.moralePerTick * group.succour;
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

    // Men in flight are not holding a flank, so none of these apply.
    if (!group.routing) {
      // Being surrounded is the fastest way a formation comes apart, and it
      // has to be: cutting an enemy off is the most expensive thing a
      // commander can arrange, so it must beat simply feeding men into his
      // front. A fully ringed regiment loses morale roughly three times as
      // fast as one merely threatened from a flank.
      if (group.encirclement > 0) {
        delta -= MORALE.flankedPenalty * (1 + 2 * group.encirclement);
      } else if (isFlanked(group, groups)) {
        delta -= MORALE.flankedPenalty * 0.5;
      }
      if (isDefensiveTerrain(group.anchor.x, group.anchor.y)) delta += MORALE.terrainBonus;

      // The crush. Men packed into a defile cannot see, cannot dress their
      // ranks and cannot get out, and formations come apart in that state well
      // before they are killed in it. This is the cost of pushing an army
      // through one gap in a single mass.
      delta -= CROWDING.moralePenalty * group.crowding;
    }

    // Exhaustion tells on troops whether they are fighting or running.
    delta -= FATIGUE.moralePenalty * group.fatigue;

    // The impact. A charge kills fewer men than the melee that follows it and
    // decides far more fights, because what it actually does is shake the
    // formation it lands on. Applied to broken men as well as steady ones: a
    // squadron riding down a rout is the reason routs do not rally, which is
    // what makes pursuit worth ordering rather than a courtesy.
    delta -= MORALE.shockPenalty * group.shock;

    // The sovereign. Men steady in sight of him, and every regiment in the army
    // feels it when he is beset — which is what makes a raid on a lightly held
    // base a real threat rather than a distraction to be ignored.
    const king = state.objective.kings[group.ownerId];
    if (!group.routing) {
      const dx = king.position.x - group.anchor.x;
      const dy = king.position.y - group.anchor.y;
      if (dx * dx + dy * dy <= OBJECTIVE.rallyRadius * OBJECTIVE.rallyRadius) {
        delta += OBJECTIVE.rallyBonus;
      }
    }
    if (king.besieged) delta -= OBJECTIVE.besiegedPenalty;

    // What is left of the regiment caps what it can recover to. Men who have
    // seen most of their formation die do not become confident again just
    // because the shooting stopped.
    const survival = group.members.length / Math.max(1, group.initialStrength);
    const ceiling = MORALE.bloodiedFloor + (100 - MORALE.bloodiedFloor) * survival;

    group.morale = Math.max(0, Math.min(ceiling, group.morale + delta));
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
