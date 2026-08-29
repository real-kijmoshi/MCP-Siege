import { UNIT_STATS } from '../config/battle';
import { ZONE_IDS, playerIdOf, type PlayerId, type ZoneId } from '../types/domain';
import type { GameState } from './GameState';
import { ZONES } from './Zones';

/**
 * Who holds each named zone.
 *
 * Control drives the "front status" projection, the `friendly_zone_lost`
 * condition, and half the alert stream. Recomputed on an interval because it
 * changes on the scale of manoeuvres, not ticks.
 */

const CONTROL_INTERVAL = 10;

/** A side must hold this share of the strength present to own a zone outright. */
const CONTROL_SHARE = 0.62;

export interface ZonePresence {
  player: number;
  enemy: number;
}

const presence = new Map<ZoneId, ZonePresence>();

export function zonePresenceOf(zoneId: ZoneId): ZonePresence {
  return presence.get(zoneId) ?? { player: 0, enemy: 0 };
}

export function advanceZoneControl(state: GameState): void {
  if (state.currentTick % CONTROL_INTERVAL !== 0) return;

  for (const id of ZONE_IDS) presence.set(id, { player: 0, enemy: 0 });

  const units = state.units;
  for (let index = 0; index < units.count; index += 1) {
    if (units.alive[index] !== 1) continue;
    const x = units.x[index] ?? 0;
    const y = units.y[index] ?? 0;
    const value = UNIT_STATS[units.categoryOf(index)].strengthValue;
    const owner = playerIdOf(units.owner[index] ?? 0);

    // Only presence actually inside a zone counts, so control means occupation.
    for (const id of ZONE_IDS) {
      const zone = ZONES[id];
      const dx = x - zone.center.x;
      const dy = y - zone.center.y;
      if (dx * dx + dy * dy > zone.radius * zone.radius) continue;
      const entry = presence.get(id);
      if (entry === undefined) continue;
      if (owner === 'player') entry.player += value;
      else entry.enemy += value;
      break;
    }
  }

  for (const id of ZONE_IDS) {
    const entry = presence.get(id) ?? { player: 0, enemy: 0 };
    const total = entry.player + entry.enemy;
    let controller: PlayerId | undefined;
    if (total > 0) {
      if (entry.player / total >= CONTROL_SHARE) controller = 'player';
      else if (entry.enemy / total >= CONTROL_SHARE) controller = 'enemy';
    } else {
      // An empty zone stays with whoever last held it.
      controller = state.zoneControl.get(id);
    }
    state.zoneControl.set(id, controller);
  }
}

export function controllerOf(state: GameState, zoneId: ZoneId): PlayerId | undefined {
  return state.zoneControl.get(zoneId);
}

/** Seeds control from the opening deployment so nothing reads as newly lost. */
export function seedZoneControl(state: GameState): void {
  const tick = state.currentTick;
  state.currentTick = 0;
  advanceZoneControl(state);
  state.currentTick = tick;
}
