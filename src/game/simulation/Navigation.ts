import type { Vector2D, ZoneId } from '../types/domain';
import { findCorridor } from './PassabilityGrid';
import {
  ZONES,
  activeZoneIds,
  isPassable,
  isRoadConnection,
  neighboursOf,
  zoneAt,
} from './Zones';

/**
 * Group-level navigation.
 *
 * Paths are computed once per order over the map's zone graph, never per
 * soldier. Because every edge that crosses the map's barrier runs through a
 * crossing, an order to move to the far side automatically routes an army onto
 * a bridge, a ford or a gap instead of marching it into the water.
 */

function distance(a: Vector2D, b: Vector2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** True when the straight segment stays on passable ground. */
export function hasClearLineOfMarch(from: Vector2D, to: Vector2D, clearance = 0): boolean {
  const span = distance(from, to);
  const steps = Math.max(2, Math.ceil(span / 60));
  const perpendicularX = span > 0 ? -(to.y - from.y) / span : 0;
  const perpendicularY = span > 0 ? (to.x - from.x) / span : 0;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    if (!isPassable(x, y)) return false;
    // Taper the footprint at the endpoints because an order may legitimately
    // begin or end beside an obstacle. The middle of the march still reserves
    // enough width that a regiment does not choose a route its ranks cannot use.
    const lane = clearance * Math.sin(Math.PI * t);
    if (lane > 0) {
      if (!isPassable(x + perpendicularX * lane, y + perpendicularY * lane)) return false;
      if (!isPassable(x - perpendicularX * lane, y - perpendicularY * lane)) return false;
    }
  }
  return true;
}

function terrainCost(zoneId: ZoneId): number {
  switch (ZONES[zoneId].terrain) {
    case 'forest':
      return 1.34;
    case 'hill':
      return 1.18;
    case 'village':
      return 1.12;
    case 'crossing':
      return 1.2;
    default:
      return 1;
  }
}

/** Weighted Dijkstra across zone centres. The graph is tiny, so this stays cheap. */
function zoneRoute(startZone: ZoneId, goalZone: ZoneId): ZoneId[] {
  if (startZone === goalZone) return [goalZone];

  const zoneIds = activeZoneIds();
  const distances = new Map<ZoneId, number>();
  const previous = new Map<ZoneId, ZoneId>();
  const unvisited = new Set<ZoneId>(zoneIds);
  for (const id of zoneIds) distances.set(id, Number.POSITIVE_INFINITY);
  distances.set(startZone, 0);

  while (unvisited.size > 0) {
    let current: ZoneId | undefined;
    let best = Number.POSITIVE_INFINITY;
    // Iterating the map's own order rather than the set keeps ties deterministic.
    for (const id of zoneIds) {
      if (!unvisited.has(id)) continue;
      const value = distances.get(id) ?? Number.POSITIVE_INFINITY;
      if (value < best) {
        best = value;
        current = id;
      }
    }
    if (current === undefined || best === Number.POSITIVE_INFINITY) break;
    if (current === goalZone) break;
    unvisited.delete(current);

    for (const neighbour of neighboursOf(current)) {
      if (!unvisited.has(neighbour)) continue;
      const ground = (terrainCost(current) + terrainCost(neighbour)) * 0.5;
      const road = isRoadConnection(current, neighbour) ? 0.82 : 1;
      const step = distance(ZONES[current].center, ZONES[neighbour].center) * ground * road;
      const candidate = best + step;
      if (candidate < (distances.get(neighbour) ?? Number.POSITIVE_INFINITY)) {
        distances.set(neighbour, candidate);
        previous.set(neighbour, current);
      }
    }
  }

  const route: ZoneId[] = [];
  let cursor: ZoneId | undefined = goalZone;
  while (cursor !== undefined) {
    route.unshift(cursor);
    if (cursor === startZone) break;
    cursor = previous.get(cursor);
  }
  return route.length > 0 && route[0] === startZone ? route : [goalZone];
}

/** Build the actual polyline represented by a zone route. */
function routeWaypoints(route: ZoneId[], to: Vector2D): Vector2D[] {
  const waypoints: Vector2D[] = [];
  for (let index = 1; index < route.length; index += 1) {
    const zone = ZONES[route[index] as ZoneId];
    waypoints.push({ x: zone.center.x, y: zone.center.y });
  }
  waypoints.push({ x: to.x, y: to.y });
  return waypoints;
}

/** Validate every leg, not just the sampled destination. */
function pathIsPassable(from: Vector2D, waypoints: Vector2D[], clearance: number): boolean {
  let cursor = from;
  for (const waypoint of waypoints) {
    if (!hasClearLineOfMarch(cursor, waypoint, clearance)) return false;
    cursor = waypoint;
  }
  return true;
}

/**
 * The zone containing a point can be broad enough to straddle the river. In
 * that case a same-zone order still needs a crossing. Try deterministic
 * one-zone detours until the complete polyline is legal.
 */
function routeCost(route: ZoneId[]): number {
  let total = 0;
  for (let index = 1; index < route.length; index += 1) {
    const previous = route[index - 1];
    const current = route[index];
    if (previous === undefined || current === undefined) continue;
    const ground = (terrainCost(previous) + terrainCost(current)) * 0.5;
    total +=
      distance(ZONES[previous].center, ZONES[current].center) *
      ground *
      (isRoadConnection(previous, current) ? 0.82 : 1);
  }
  return total;
}

function passableRoute(
  from: Vector2D,
  to: Vector2D,
  start: ZoneId,
  goal: ZoneId,
  clearance: number,
): Vector2D[] {
  const candidates: ZoneId[][] = [zoneRoute(start, goal)];
  for (const via of activeZoneIds()) {
    if (via === start || via === goal) continue;
    const first = zoneRoute(start, via);
    const second = zoneRoute(via, goal);
    if (first[0] !== start || second[0] !== via) continue;
    candidates.push([...first, ...second.slice(1)]);
  }

  // Prefer shorter, then lexicographically earlier routes for deterministic
  // behaviour when more than one crossing is legal.
  candidates.sort((a, b) => {
    const cost = routeCost(a) - routeCost(b);
    if (Math.abs(cost) > 0.001) return cost;
    if (a.length !== b.length) return a.length - b.length;
    const left = a.join('|');
    const right = b.join('|');
    return left < right ? -1 : left > right ? 1 : 0;
  });
  for (const route of candidates) {
    const waypoints = routeWaypoints(route, to);
    if (pathIsPassable(from, waypoints, clearance)) return waypoints;
  }

  // A zone graph is deliberately broad: it knows which named places connect,
  // but not every mere, angled bank or narrow shoulder inside those places.
  // When every authored route fails against the real geometry, fall back to a
  // deterministic corridor over passable ground. This used to be imported but
  // never called, leaving a valid regiment with a permanently blocked first
  // waypoint on the Sunken Causeway.
  const corridor = findCorridor(from, to, clearance);
  if (corridor !== null && corridor.length > 0) return corridor;

  // A genuinely disconnected map is an authoring error. Retain the semantic
  // route so callers still receive a useful destination and map tests expose
  // the invalid leg, rather than converting it into a silent empty order.
  return routeWaypoints(candidates[0] ?? [goal], to);
}

/**
 * Waypoints for a group marching from `from` to `to`.
 *
 * A clear straight march produces a single waypoint. Anything that would cross
 * water is routed through zone centres, which threads it onto a crossing.
 */
export function computePath(from: Vector2D, to: Vector2D, clearance = 0): Vector2D[] {
  if (hasClearLineOfMarch(from, to, clearance)) return [{ x: to.x, y: to.y }];

  const waypoints = passableRoute(
    from,
    to,
    zoneAt(from.x, from.y),
    zoneAt(to.x, to.y),
    clearance,
  );

  // Greedy line-of-march smoothing removes zone-centre zigzags while retaining
  // the crossing or obstacle corners that actually make the route legal.
  const smoothed: Vector2D[] = [];
  let cursor = from;
  let index = 0;
  while (index < waypoints.length) {
    let furthest = index;
    for (let candidate = waypoints.length - 1; candidate > index; candidate -= 1) {
      const point = waypoints[candidate];
      if (point !== undefined && hasClearLineOfMarch(cursor, point, clearance)) {
        furthest = candidate;
        break;
      }
    }
    const chosen = waypoints[furthest];
    if (chosen === undefined) break;
    smoothed.push(chosen);
    cursor = chosen;
    index = furthest + 1;
  }
  return smoothed.length > 0 ? smoothed : waypoints;
}

/** A sensible muster point inside a zone for a group approaching from `from`. */
export function approachPoint(zoneId: ZoneId, from: Vector2D): Vector2D {
  const zone = ZONES[zoneId];
  const dx = from.x - zone.center.x;
  const dy = from.y - zone.center.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return { x: zone.center.x, y: zone.center.y };
  // Stop short of the centre, on the near side, so arriving armies do not stack.
  const inset = Math.min(zone.radius * 0.45, length);
  return {
    x: zone.center.x + (dx / length) * inset,
    y: zone.center.y + (dy / length) * inset,
  };
}
