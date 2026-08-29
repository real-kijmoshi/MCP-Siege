import { TICKS_PER_SECOND } from '../config/battle';
import type { GameCommandPayload, OrderGroupsPayload } from '../commands/types';
import type { Formation, OrderKind, Stance, ZoneId } from '../types/domain';
import { activeGroups, findGroup, type GameState } from './GameState';

/**
 * The opposing commander.
 *
 * A scripted escalation gives the scenario its shape, and a light reactive
 * layer keeps it from feeling like a cutscene. Everything it does is submitted
 * as an ordinary command, so the enemy plays by exactly the same rules.
 */

interface ScriptedOrder {
  atSeconds: number;
  groupId: string;
  order: OrderKind;
  targetZone?: ZoneId;
  formation?: Formation;
  stance?: Stance;
}

/**
 * The escalation. Quiet enough at first to learn the controls by hand, then
 * three fronts at once, which is the moment delegating to the Marshal stops
 * being a demo and starts being the only way to keep up.
 */
const SCRIPT: readonly ScriptedOrder[] = [
  // The centre commits: onto the bridge first, then across it into the field
  // where the player's line is actually standing.
  { atSeconds: 40, groupId: 'iron_host', order: 'attack_zone', targetZone: 'central_bridge', formation: 'column' },
  { atSeconds: 45, groupId: 'ash_legion', order: 'attack_zone', targetZone: 'central_bridge', formation: 'column' },
  { atSeconds: 50, groupId: 'northern_spears', order: 'attack_zone', targetZone: 'central_bridge', formation: 'column' },
  { atSeconds: 60, groupId: 'black_arrows', order: 'move', targetZone: 'central_bridge', formation: 'column' },
  { atSeconds: 85, groupId: 'iron_host', order: 'attack_zone', targetZone: 'central_field', formation: 'line' },
  { atSeconds: 92, groupId: 'ash_legion', order: 'attack_zone', targetZone: 'central_field', formation: 'line' },
  { atSeconds: 100, groupId: 'northern_spears', order: 'attack_zone', targetZone: 'central_field', formation: 'double_line' },

  // Cavalry threatens the east.
  { atSeconds: 115, groupId: 'night_riders', order: 'attack_zone', targetZone: 'east_crossing', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 150, groupId: 'night_riders', order: 'attack_zone', targetZone: 'east_field', formation: 'wedge' },

  // Pressure on the west.
  { atSeconds: 175, groupId: 'storm_riders', order: 'attack_zone', targetZone: 'west_crossing', formation: 'wedge', stance: 'aggressive' },

  // Siege comes forward and the reserve follows the centre.
  { atSeconds: 235, groupId: 'siege_train', order: 'attack_zone', targetZone: 'central_bridge', formation: 'loose', stance: 'hold_ground' },
  { atSeconds: 250, groupId: 'ashen_reserve', order: 'move', targetZone: 'enemy_outer_defense' },
  { atSeconds: 300, groupId: 'storm_riders', order: 'attack_zone', targetZone: 'central_field', formation: 'wedge' },
  { atSeconds: 340, groupId: 'ashen_reserve', order: 'attack_zone', targetZone: 'central_bridge' },
];

const REACTION_INTERVAL = TICKS_PER_SECOND * 5;

function scriptedThisTick(state: GameState): GameCommandPayload[] {
  const commands: GameCommandPayload[] = [];
  for (const entry of SCRIPT) {
    // Fires on exactly the tick it comes due, so the script never repeats.
    if (state.currentTick !== Math.round(entry.atSeconds * TICKS_PER_SECOND)) continue;
    const group = findGroup(state, entry.groupId);
    if (group === undefined || group.members.length === 0) continue;

    const payload: OrderGroupsPayload = {
      type: 'order_groups',
      playerId: 'enemy',
      groupIds: [entry.groupId],
      order: entry.order,
    };
    if (entry.targetZone !== undefined) payload.targetZone = entry.targetZone;
    if (entry.formation !== undefined) payload.formation = entry.formation;
    if (entry.stance !== undefined) payload.stance = entry.stance;
    commands.push(payload);
  }
  return commands;
}

/** Idle enemy formations look for the nearest thing they can actually see. */
function reactions(state: GameState): GameCommandPayload[] {
  if (state.currentTick % REACTION_INTERVAL !== 0) return [];

  const commands: GameCommandPayload[] = [];
  const contacts = [...state.contacts.enemy.values()].filter((contact) => contact.visibleNow);
  if (contacts.length === 0) return commands;

  for (const group of activeGroups(state, 'enemy')) {
    if (group.routing) continue;
    if (group.order.kind !== 'idle' && group.order.kind !== 'hold') continue;
    // Siege is committed by the script alone; it must not wander into a melee.
    if (group.members.some((index) => state.units.categoryOf(index) === 'siege')) continue;

    let nearest = contacts[0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const contact of contacts) {
      const dx = contact.lastPosition.x - group.anchor.x;
      const dy = contact.lastPosition.y - group.anchor.y;
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = contact;
      }
    }

    if (nearest === undefined) continue;
    // Only respond to a genuinely close threat; otherwise hold the line.
    if (nearestDistance > 1500 * 1500) continue;

    commands.push({
      type: 'order_groups',
      playerId: 'enemy',
      groupIds: [group.id],
      order: 'attack_zone',
      targetZone: nearest.lastSeenZone,
    });
  }

  return commands;
}

export function enemyAiCommands(state: GameState): GameCommandPayload[] {
  return [...scriptedThisTick(state), ...reactions(state)];
}
