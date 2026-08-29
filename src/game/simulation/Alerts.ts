import { TICKS_PER_SECOND } from '../config/battle';
import { ZONE_IDS, type AlertSeverity, type BattleAlert, type ZoneId } from '../types/domain';
import { activeGroups, nextEntityId, type GameState } from './GameState';
import { ZONES } from './Zones';

/**
 * Strategic event generation.
 *
 * Alerts are what let an external Marshal notice a collapsing flank without
 * polling every group every second. They are deduplicated by key and rate
 * limited, so the feed stays readable rather than becoming a firehose.
 */

const ALERT_INTERVAL = 10;
const MAX_ALERTS = 40;

const COOLDOWNS: Record<string, number> = {
  morale: TICKS_PER_SECOND * 25,
  zone: TICKS_PER_SECOND * 15,
  contact: TICKS_PER_SECOND * 30,
  attack: TICKS_PER_SECOND * 20,
  idle: TICKS_PER_SECOND * 45,
  reinforcement: TICKS_PER_SECOND * 30,
};

function raise(
  state: GameState,
  key: string,
  family: keyof typeof COOLDOWNS,
  severity: AlertSeverity,
  message: string,
  extra: { zoneId?: ZoneId; groupId?: string } = {},
): void {
  const readyAt = state.alertCooldowns.get(key) ?? -1;
  if (state.currentTick < readyAt) return;
  state.alertCooldowns.set(key, state.currentTick + (COOLDOWNS[family] ?? TICKS_PER_SECOND * 20));

  const alert: BattleAlert = {
    id: nextEntityId(state, 'alert'),
    key,
    severity,
    message,
    tick: state.currentTick,
    ...extra,
  };
  state.alerts.push(alert);
  if (state.alerts.length > MAX_ALERTS) state.alerts.shift();
}

export function advanceAlerts(state: GameState): void {
  if (state.currentTick % ALERT_INTERVAL !== 0) return;

  for (const group of activeGroups(state, 'player')) {
    const strengthPercent = (group.members.length / Math.max(1, group.initialStrength)) * 100;

    if (group.moraleState === 'routing') {
      raise(state, `morale:${group.id}:routing`, 'morale', 'critical', `${group.name} is routing.`, {
        groupId: group.id,
      });
    } else if (group.moraleState === 'breaking') {
      raise(
        state,
        `morale:${group.id}:breaking`,
        'morale',
        'critical',
        `${group.name} morale is breaking (${Math.round(group.morale)}%).`,
        { groupId: group.id },
      );
    } else if (group.moraleState === 'shaken') {
      raise(
        state,
        `morale:${group.id}:shaken`,
        'morale',
        'warning',
        `${group.name} morale is falling (${Math.round(group.morale)}%).`,
        { groupId: group.id },
      );
    }

    // Sustained casualties rather than a single skirmish.
    if (group.recentCasualties > Math.max(6, group.members.length * 0.02)) {
      raise(
        state,
        `attack:${group.id}`,
        'attack',
        'warning',
        `${group.name} is under heavy attack.`,
        { groupId: group.id },
      );
    }

    if (strengthPercent < 40) {
      raise(
        state,
        `attack:${group.id}:spent`,
        'attack',
        'critical',
        `${group.name} is down to ${Math.round(strengthPercent)}% strength.`,
        { groupId: group.id },
      );
    }

    if (
      group.order.kind === 'idle' &&
      group.members.length > 100 &&
      state.currentTick > TICKS_PER_SECOND * 20
    ) {
      raise(state, `idle:${group.id}`, 'idle', 'info', `${group.name} is idle and available.`, {
        groupId: group.id,
      });
    }
  }

  for (const zoneId of ZONE_IDS) {
    const controller = state.zoneControl.get(zoneId);
    const previous = state.zoneControlPrevious.get(zoneId);
    if (previous !== controller) {
      state.zoneControlPrevious.set(zoneId, controller);
      if (previous === 'player' && controller !== 'player') {
        raise(state, `zone:${zoneId}:lost`, 'zone', 'critical', `${ZONES[zoneId].name} lost.`, {
          zoneId,
        });
      } else if (controller === 'player' && previous !== undefined) {
        raise(state, `zone:${zoneId}:taken`, 'zone', 'info', `${ZONES[zoneId].name} secured.`, {
          zoneId,
        });
      }
    }
  }

  for (const contact of state.contacts.player.values()) {
    if (!contact.visibleNow) continue;
    if (contact.composition.includes('cavalry')) {
      raise(
        state,
        `contact:cavalry:${contact.lastSeenZone}`,
        'contact',
        'warning',
        `Enemy cavalry sighted at ${ZONES[contact.lastSeenZone].name}.`,
        { zoneId: contact.lastSeenZone },
      );
    }
    if (contact.composition.includes('siege')) {
      raise(
        state,
        `contact:siege:${contact.lastSeenZone}`,
        'contact',
        'critical',
        `Enemy siege sighted at ${ZONES[contact.lastSeenZone].name}.`,
        { zoneId: contact.lastSeenZone },
      );
    }
  }

  if (state.players.player.availableWaves > 0) {
    raise(
      state,
      'reinforcement:available',
      'reinforcement',
      'info',
      `Reinforcements available (${state.players.player.availableWaves} wave(s)).`,
    );
  }
}

/** Baselines zone control at startup so the opening deployment reads as normal. */
export function resetAlertTracking(state: GameState): void {
  state.zoneControlPrevious.clear();
  for (const zoneId of ZONE_IDS) {
    state.zoneControlPrevious.set(zoneId, state.zoneControl.get(zoneId));
  }
}
