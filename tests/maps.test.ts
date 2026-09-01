import { describe, expect, it } from 'vitest';
import { MAP_HEIGHT, MAP_WIDTH } from '../src/game/config/battle';
import {
  BATTLE_MAPS,
  BATTLE_MAP_IDS,
  ZONE_CATALOGUE,
  barrierCenterY,
  type BattleMapId,
} from '../src/game/config/maps';
import { SCENARIOS } from '../src/game/config/scenario';
import { SCENARIO_IDS } from '../src/game/config/matches';
import { computePath } from '../src/game/simulation/Navigation';
import { SimulationEngine } from '../src/game/simulation/Engine';
import {
  activeZoneIds,
  barrierCenterAt,
  homeZoneOf,
  isPassable,
  neighboursOf,
  useBattleMap,
  zoneAt,
} from '../src/game/simulation/Zones';
import { ZONE_IDS, type ZoneId } from '../src/game/types/domain';

/**
 * Map integrity.
 *
 * A battlefield is authored by hand as coordinates, so the mistakes it can
 * contain are geometric: a zone centre in the water, a gap that is not actually
 * on the barrier, a corner of the graph nothing connects to, an army with no
 * road to the enemy king. None of those would throw — they would just make a
 * battle quietly unplayable — so every one of them is checked here.
 */

function walkIsPassable(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 40);
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    if (!isPassable(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)) return false;
  }
  return true;
}

describe('battle maps', () => {
  it('claims every zone id exactly once', () => {
    const claimed = new Set<ZoneId>();
    for (const mapId of BATTLE_MAP_IDS) {
      for (const zone of BATTLE_MAPS[mapId].zones) {
        expect(claimed.has(zone.id), `${zone.id} claimed twice`).toBe(false);
        claimed.add(zone.id);
      }
    }
    expect(claimed.size).toBe(ZONE_IDS.length);
    expect(Object.keys(ZONE_CATALOGUE).length).toBe(ZONE_IDS.length);
  });

  for (const mapId of BATTLE_MAP_IDS) {
    describe(mapId, () => {
      const map = BATTLE_MAPS[mapId];

      it('stands every zone on passable ground inside the field', () => {
        useBattleMap(mapId);
        for (const zone of map.zones) {
          expect(zone.center.x, `${zone.id} x`).toBeGreaterThan(0);
          expect(zone.center.x, `${zone.id} x`).toBeLessThan(MAP_WIDTH);
          expect(zone.center.y, `${zone.id} y`).toBeGreaterThan(0);
          expect(zone.center.y, `${zone.id} y`).toBeLessThan(MAP_HEIGHT);
          expect(isPassable(zone.center.x, zone.center.y), `${zone.id} is unreachable`).toBe(true);
          // A zone must own its own centre, or every report about it lies.
          expect(zoneAt(zone.center.x, zone.center.y), `${zone.id} centre`).toBe(zone.id);
        }
      });

      it('connects every zone to the rest of the map', () => {
        useBattleMap(mapId);
        const seen = new Set<ZoneId>([map.playerHomeZone]);
        const queue: ZoneId[] = [map.playerHomeZone];
        while (queue.length > 0) {
          const current = queue.shift() as ZoneId;
          for (const neighbour of neighboursOf(current)) {
            if (seen.has(neighbour)) continue;
            seen.add(neighbour);
            queue.push(neighbour);
          }
        }
        expect(seen.size, 'unreachable zones in the graph').toBe(map.zones.length);
        expect(activeZoneIds().length).toBe(map.zones.length);
      });

      it('names both home zones and puts reinforcements on the map', () => {
        useBattleMap(mapId);
        expect(homeZoneOf('player').id).toBe(map.playerHomeZone);
        expect(homeZoneOf('enemy').id).toBe(map.enemyHomeZone);
        expect(map.playerHomeZone).not.toBe(map.enemyHomeZone);
      });

      it('only draws roads between its own zones', () => {
        const ids = new Set(map.zones.map((zone) => zone.id));
        for (const road of map.roads) {
          expect(road.length).toBeGreaterThan(1);
          for (const id of road) expect(ids.has(id), `${id} is not on ${mapId}`).toBe(true);
        }
        for (const [from, to] of map.edges) {
          expect(ids.has(from), `${from} is not on ${mapId}`).toBe(true);
          expect(ids.has(to), `${to} is not on ${mapId}`).toBe(true);
        }
      });

      it('leaves a marchable road from one command seat to the other', () => {
        useBattleMap(mapId);
        const from = ZONE_CATALOGUE[map.playerHomeZone].center;
        const to = ZONE_CATALOGUE[map.enemyHomeZone].center;
        const path = computePath(from, to);

        let cursor = from;
        for (const waypoint of path) {
          expect(
            walkIsPassable(cursor, waypoint),
            `${mapId}: leg to ${Math.round(waypoint.x)},${Math.round(waypoint.y)} crosses impassable ground`,
          ).toBe(true);
          cursor = waypoint;
        }
        const last = path[path.length - 1];
        expect(Math.hypot((last?.x ?? 0) - to.x, (last?.y ?? 0) - to.y)).toBeLessThan(1);
      });

      const barrier = map.barrier;
      if (barrier !== undefined) {
        it('divides the field, and only the crossings pass it', () => {
          useBattleMap(mapId);
          const crossings = map.zones.filter((zone) => zone.crossing);
          expect(crossings.length).toBeGreaterThan(0);

          for (const crossing of crossings) {
            // A gap that is not on the barrier is a gap in nothing.
            const offset = Math.abs(crossing.center.y - barrierCenterY(barrier, crossing.center.x));
            expect(offset, `${crossing.id} is off the barrier`).toBeLessThan(barrier.halfWidth);
            expect(isPassable(crossing.center.x, crossing.center.y)).toBe(true);
          }

          // Everywhere else along the centreline is closed.
          let blocked = 0;
          let sampled = 0;
          for (let x = 100; x < MAP_WIDTH; x += 100) {
            const onCrossing = crossings.some(
              (crossing) => Math.abs(x - crossing.center.x) < crossing.radius * 0.62,
            );
            if (onCrossing) continue;
            sampled += 1;
            if (!isPassable(x, barrierCenterAt(x))) blocked += 1;
          }
          expect(sampled).toBeGreaterThan(20);
          expect(blocked).toBe(sampled);
        });

        it('seats the two command seats on opposite sides of it', () => {
          useBattleMap(mapId);
          const player = ZONE_CATALOGUE[map.playerHomeZone].center;
          const enemy = ZONE_CATALOGUE[map.enemyHomeZone].center;
          expect(player.y).toBeGreaterThan(barrierCenterAt(player.x));
          expect(enemy.y).toBeLessThan(barrierCenterAt(enemy.x));
        });
      }
    });
  }
});

describe('scenario deployments', () => {
  for (const scenarioId of SCENARIO_IDS) {
    const scenario = SCENARIOS[scenarioId];

    it(`${scenarioId} deploys both armies on its own map`, () => {
      useBattleMap(scenario.mapId);
      const mapZones = new Set(BATTLE_MAPS[scenario.mapId].zones.map((zone) => zone.id));

      for (const spec of [...scenario.playerGroups, ...scenario.enemyGroups]) {
        expect(
          isPassable(spec.anchor.x, spec.anchor.y),
          `${scenarioId}: ${spec.id} deploys on impassable ground`,
        ).toBe(true);
        expect(spec.anchor.x).toBeGreaterThan(200);
        expect(spec.anchor.x).toBeLessThan(MAP_WIDTH - 200);
        expect(spec.anchor.y).toBeGreaterThan(200);
        expect(spec.anchor.y).toBeLessThan(MAP_HEIGHT - 200);
      }

      // Every scripted order must name ground that exists on this map, or the
      // enemy commander silently does nothing at the moment he should attack.
      for (const order of scenario.aiScript) {
        if (order.targetZone === undefined) continue;
        expect(
          mapZones.has(order.targetZone),
          `${scenarioId}: script targets ${order.targetZone}, which is not on ${scenario.mapId}`,
        ).toBe(true);
      }

      const groupIds = new Set(scenario.enemyGroups.map((group) => group.id));
      for (const order of scenario.aiScript) {
        expect(groupIds.has(order.groupId), `${scenarioId}: no such group ${order.groupId}`).toBe(
          true,
        );
      }
    });

    it(`${scenarioId} dresses every soldier on passable ground`, () => {
      const engine = new SimulationEngine({ scenarioId, difficultyId: 'captain' });
      const state = engine.getState();
      useBattleMap(state.mapId);

      for (let index = 0; index < state.units.count; index += 1) {
        if (state.units.alive[index] !== 1) continue;
        const x = state.units.x[index] ?? -1;
        const y = state.units.y[index] ?? -1;
        expect(isPassable(x, y), `${scenarioId}: soldier ${index} spawned at ${x}, ${y}`).toBe(true);
      }
    });
  }

  it('covers every authored map with at least one operation', () => {
    const used = new Set<BattleMapId>(SCENARIO_IDS.map((id) => SCENARIOS[id].mapId));
    for (const mapId of BATTLE_MAP_IDS) {
      expect(used.has(mapId), `no operation is fought on ${mapId}`).toBe(true);
    }
  });
});
