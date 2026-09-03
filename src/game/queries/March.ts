import {
  CONTACT,
  FORMATION_PROFILES,
  TICKS_PER_SECOND,
  UNIT_STATS,
  terrainSpeedModifier,
} from '../config/battle';
import { computePath, approachPoint } from '../simulation/Navigation';
import { activeGroups, findGroup, type GameState } from '../simulation/GameState';
import { ZONES, terrainAt, zoneAt } from '../simulation/Zones';
import {
  UNIT_CATEGORIES,
  type ArmyGroup,
  type PlayerId,
  type UnitCategory,
  type Vector2D,
  type ZoneId,
} from '../types/domain';

/**
 * How long a march actually takes.
 *
 * Timing is most of what a plan is, and until this existed it could not be
 * done from outside at all: the Marshal has named zones rather than
 * coordinates, by design, so it could not measure a distance, and it had no
 * way to learn that a battery moves at a sixth of the pace of horse or that a
 * wood costs a gun two thirds of its speed. Plans came out as sequences with
 * no clock in them, and reserves arrived after the fight they were meant for.
 *
 * The route is the same one `Navigation` would give the group, walked in short
 * steps so the ground under each leg is priced rather than assumed to be the
 * ground the regiment is standing on now. It reveals no coordinates: what comes
 * back is a distance, a time, and the named ground the road passes through.
 */

/** Sampling interval along a leg, in paces. Fine enough to price a wood. */
const SAMPLE_STEP = 40;

export interface MarchEstimate {
  groupId: string;
  name: string;
  /** Paces along the route the group would actually take. */
  distance: number;
  seconds: number;
  /** Named ground the route passes through, in order. */
  route: string[];
  /** The arm that sets the pace of the whole formation. */
  slowestArm: UnitCategory;
  /** True when the route threads a crossing, which is where marches are lost. */
  usesCrossing: boolean;
  /** True when the group is held in contact and cannot march off at all. */
  pinned: boolean;
  routing: boolean;
  /** True while the group's guns are limbered, and so not a weapon on arrival. */
  bringsGuns: boolean;
  warnings: string[];
}

export interface MarchReport {
  targetZone: ZoneId;
  targetZoneName: string;
  terrain: string;
  estimates: MarchEstimate[];
  /** Seconds between the first regiment arriving and the last. */
  arrivalSpread: number;
  summary: string;
  note: string;
}

export class MarchError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly suggestions: string[] = [],
  ) {
    super(message);
    this.name = 'MarchError';
  }
}

/** The arm that sets a formation's pace, and its speed on given ground. */
function paceOf(
  state: GameState,
  group: ArmyGroup,
  terrain: string,
): { arm: UnitCategory; speed: number } {
  const present = new Set<UnitCategory>();
  for (const index of group.members) present.add(state.units.categoryOf(index));

  let arm: UnitCategory = 'infantry';
  let slowest = Number.POSITIVE_INFINITY;
  // Canonical order rather than set order, so a dead heat always resolves alike.
  for (const category of UNIT_CATEGORIES) {
    if (!present.has(category)) continue;
    const speed = UNIT_STATS[category].speed * terrainSpeedModifier(category, terrain);
    if (speed < slowest) {
      slowest = speed;
      arm = category;
    }
  }
  if (!Number.isFinite(slowest)) return { arm, speed: 0 };
  return { arm, speed: slowest * FORMATION_PROFILES[group.formation].speedModifier };
}

/** Walks a leg in short steps, pricing the ground under each one. */
function marchLeg(
  state: GameState,
  group: ArmyGroup,
  from: Vector2D,
  to: Vector2D,
  visited: Set<ZoneId>,
): { distance: number; ticks: number; slowestArm: UnitCategory } {
  const spanX = to.x - from.x;
  const spanY = to.y - from.y;
  const distance = Math.hypot(spanX, spanY);
  if (distance <= 0) return { distance: 0, ticks: 0, slowestArm: 'infantry' };

  const steps = Math.max(1, Math.ceil(distance / SAMPLE_STEP));
  const stepLength = distance / steps;
  let ticks = 0;
  let slowestArm: UnitCategory = 'infantry';
  let slowestSpeed = Number.POSITIVE_INFINITY;

  for (let step = 0; step < steps; step += 1) {
    const share = (step + 0.5) / steps;
    const x = from.x + spanX * share;
    const y = from.y + spanY * share;
    visited.add(zoneAt(x, y));
    const { arm, speed } = paceOf(state, group, terrainAt(x, y));
    if (speed <= 0) return { distance, ticks: Infinity, slowestArm: arm };
    ticks += stepLength / speed;
    if (speed < slowestSpeed) {
      slowestSpeed = speed;
      slowestArm = arm;
    }
  }

  return { distance, ticks, slowestArm };
}

export function estimateMarch(
  state: GameState,
  playerId: PlayerId,
  groupIds: readonly string[],
  targetZone: ZoneId,
): MarchReport {
  const zone = ZONES[targetZone];
  const estimates: MarchEstimate[] = [];

  const ids = groupIds.length > 0 ? groupIds : activeGroups(state, playerId).map((group) => group.id);

  for (const groupId of ids) {
    const group = findGroup(state, groupId);
    if (group === undefined || group.ownerId !== playerId || group.members.length === 0) {
      throw new MarchError('GROUP_NOT_FOUND', `No group named "${groupId}" under your command.`, [
        'Call get_armies for the ids you may command.',
      ]);
    }

    const destination = approachPoint(targetZone, group.anchor);
    const waypoints = computePath(group.anchor, destination);
    const visited = new Set<ZoneId>([zoneAt(group.anchor.x, group.anchor.y)]);

    let cursor: Vector2D = group.anchor;
    let distance = 0;
    let ticks = 0;
    let slowestArm: UnitCategory = 'infantry';
    let slowestSpeed = Number.POSITIVE_INFINITY;

    for (const waypoint of waypoints) {
      const leg = marchLeg(state, group, cursor, waypoint, visited);
      distance += leg.distance;
      ticks += leg.ticks;
      const speed = UNIT_STATS[leg.slowestArm].speed;
      if (speed < slowestSpeed) {
        slowestSpeed = speed;
        slowestArm = leg.slowestArm;
      }
      cursor = waypoint;
    }

    const warnings: string[] = [];
    const pinned = !group.routing && group.engagement >= CONTACT.pinEngagement;
    if (pinned) {
      warnings.push(
        `It is held in contact and marches at ${Math.round(CONTACT.pinnedSpeed * 100)}% of pace until the ` +
          'fight is settled. This estimate assumes it gets clear first.',
      );
    }
    if (group.routing) warnings.push('It has broken and will not take an order until it has rallied.');

    const route = [...visited]
      .filter((id) => id !== zoneAt(group.anchor.x, group.anchor.y))
      .map((id) => ZONES[id].name);
    const usesCrossing = [...visited].some((id) => ZONES[id].crossing);
    if (usesCrossing) {
      warnings.push(
        'The route threads a crossing. Send it in column, and do not push several regiments through at once.',
      );
    }

    const bringsGuns = group.members.some(
      (index) => UNIT_STATS[state.units.categoryOf(index)].deployTicks > 0,
    );
    if (bringsGuns) {
      const deploy = Math.round(
        Math.max(
          ...group.members.map((index) => UNIT_STATS[state.units.categoryOf(index)].deployTicks),
        ) / TICKS_PER_SECOND,
      );
      warnings.push(`It brings guns: add ${deploy}s standing still after arrival before they can fire.`);
    }
    if (!Number.isFinite(ticks)) {
      warnings.push('No march is possible: this formation cannot move at all.');
    }

    estimates.push({
      groupId: group.id,
      name: group.name,
      distance: Math.round(distance),
      seconds: Number.isFinite(ticks) ? Math.round(ticks / TICKS_PER_SECOND) : -1,
      route,
      slowestArm,
      usesCrossing,
      pinned,
      routing: group.routing,
      bringsGuns,
      warnings,
    });
  }

  estimates.sort((a, b) => a.seconds - b.seconds || a.groupId.localeCompare(b.groupId));
  const arrivals = estimates.filter((estimate) => estimate.seconds >= 0).map((e) => e.seconds);
  const spread = arrivals.length === 0 ? 0 : Math.max(...arrivals) - Math.min(...arrivals);

  const first = estimates[0];
  const last = estimates[estimates.length - 1];
  const summary =
    first === undefined || last === undefined
      ? `Nothing was asked to march on ${zone.name}.`
      : estimates.length === 1
        ? `${first.name} reaches ${zone.name} in about ${first.seconds}s.`
        : `${first.name} arrives first at about ${first.seconds}s; ${last.name} is ${spread}s behind it. ` +
          (spread > 30
            ? 'Committing them as they arrive feeds them in piecemeal — start the slower ones earlier, or hold the fast ones back.'
            : 'They arrive close enough together to fight as one body.');

  return {
    targetZone,
    targetZoneName: zone.name,
    terrain: terrainAt(zone.center.x, zone.center.y),
    estimates,
    arrivalSpread: spread,
    summary,
    note:
      'Times are for an unopposed march along the route the group would actually take, priced over the ' +
      'ground it crosses. Contact, crowding at a defile and a change of orders all lengthen it.',
  };
}
