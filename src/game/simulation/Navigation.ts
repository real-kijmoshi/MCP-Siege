import { ZONE_IDS, type Vector2D, type ZoneId } from '../types/domain';
import { ZONES, ZONE_NEIGHBOURS, isPassable, zoneAt } from './Zones';

/**
 * Group-level navigation.
 *
 * Paths are computed once per order over a thirteen-node zone graph, never per
 * soldier. Because every edge that changes bank runs through a crossing, an
 * order to move north automatically routes an army onto a bridge or ford
 * instead of marching it into the river.
 */

function distance(a: Vector2D, b: Vector2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** True when the straight segment stays on passable ground. */
export function hasClearLineOfMarch(from: Vector2D, to: Vector2D): boolean {
  const span = distance(from, to);
  const steps = Math.max(2, Math.ceil(span / 60));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    if (!isPassable(x, y)) return false;
  }
  return true;
}

/** Dijkstra across zone centres. The graph is tiny, so this stays cheap. */
function zoneRoute(startZone: ZoneId, goalZone: ZoneId): ZoneId[] {
  if (startZone === goalZone) return [goalZone];

  const distances = new Map<ZoneId, number>();
  const previous = new Map<ZoneId, ZoneId>();
  const unvisited = new Set<ZoneId>(ZONE_IDS);
  for (const id of ZONE_IDS) distances.set(id, Number.POSITIVE_INFINITY);
  distances.set(startZone, 0);

  while (unvisited.size > 0) {
    let current: ZoneId | undefined;
    let best = Number.POSITIVE_INFINITY;
    // Iterating ZONE_IDS rather than the set keeps tie-breaks deterministic.
    for (const id of ZONE_IDS) {
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

    for (const neighbour of ZONE_NEIGHBOURS[current]) {
      if (!unvisited.has(neighbour)) continue;
      const step = distance(ZONES[current].center, ZONES[neighbour].center);
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

/**
 * Waypoints for a group marching from `from` to `to`.
 *
 * A clear straight march produces a single waypoint. Anything that would cross
 * water is routed through zone centres, which threads it onto a crossing.
 */
export function computePath(from: Vector2D, to: Vector2D): Vector2D[] {
  if (hasClearLineOfMarch(from, to)) return [{ x: to.x, y: to.y }];

  const route = zoneRoute(zoneAt(from.x, from.y), zoneAt(to.x, to.y));
  const waypoints: Vector2D[] = [];
  for (let index = 1; index < route.length; index += 1) {
    const zone = ZONES[route[index] as ZoneId];
    waypoints.push({ x: zone.center.x, y: zone.center.y });
  }
  waypoints.push({ x: to.x, y: to.y });

  // Drop leading waypoints already reachable directly, so groups do not detour
  // back through a zone centre they have effectively passed.
  while (waypoints.length > 1) {
    const second = waypoints[1];
    if (second === undefined || !hasClearLineOfMarch(from, second)) break;
    waypoints.shift();
  }
  return waypoints;
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
