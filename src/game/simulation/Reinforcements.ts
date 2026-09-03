import { REINFORCEMENTS } from '../config/battle';
import { PLAYER_IDS, factionOf, type ArmyGroup, type PlayerId, type UnitCategory } from '../types/domain';
import { fillFormationSlots } from './Formations';
import { registerGroup, type GameState } from './GameState';
import { homeZoneOf, zoneAt } from './Zones';

/**
 * Reinforcements.
 *
 * The scenario has no base building. Manpower simply accrues, banks into waves,
 * and a wave is committed as a fresh group at the muster point. This exists to
 * give the top bar something true to show and to supply the "reinforcements
 * arrive" beat of the scenario, not to become an economy.
 */

const WAVE_COMPOSITION: ReadonlyArray<readonly [UnitCategory, number]> = [
  ['infantry', 130],
  ['spearman', 50],
  ['archer', 40],
];

export function advanceReinforcements(state: GameState): void {
  for (const playerId of PLAYER_IDS) {
    const player = state.players[playerId];
    player.manpower += REINFORCEMENTS.manpowerPerTick;
    while (player.manpower >= REINFORCEMENTS.waveCost) {
      player.manpower -= REINFORCEMENTS.waveCost;
      player.availableWaves += 1;
    }
  }
}

/** Commits one banked wave as a new group at the owner's muster point. */
export function deployWave(state: GameState, playerId: PlayerId, name: string): ArmyGroup | undefined {
  const player = state.players[playerId];
  if (player.availableWaves <= 0) return undefined;
  player.availableWaves -= 1;
  player.wavesDeployed += 1;

  const home = homeZoneOf(playerId);
  const facing = playerId === 'player' ? -Math.PI / 2 : Math.PI / 2;
  // Offset each wave so successive arrivals do not spawn on top of each other.
  const anchor = {
    x: home.center.x + ((player.wavesDeployed % 3) - 1) * 320,
    y: home.center.y + (playerId === 'player' ? 260 : -260),
  };

  const slot = state.groups.length;
  const total = WAVE_COMPOSITION.reduce((sum, [, count]) => sum + count, 0);

  const group: ArmyGroup = {
    id: `${playerId}_reinforcement_${player.wavesDeployed}`,
    name,
    ownerId: playerId,
    members: [],
    formation: 'block',
    stance: 'defensive',
    order: { kind: 'idle', issuedAtTick: state.currentTick },
    anchor,
    facing,
    morale: 100,
    moraleState: 'confident',
    path: [],
    stallTicks: 0,
    lastReplanTick: -1,
    initialStrength: total,
    homeZone: zoneAt(anchor.x, anchor.y),
    lastCasualtyTick: -1,
    recentCasualties: 0,
    routing: false,
    engagement: 0,
    encirclement: 0,
    crowding: 0,
    fatigue: 0,
    succour: 0,
    shock: 0,
    blockedFire: 0,
  };

  const xs = new Float32Array(total);
  const ys = new Float32Array(total);
  fillFormationSlots('block', total, anchor, facing, xs, ys);

  const faction = factionOf(playerId);
  let index = 0;
  for (const [category, count] of WAVE_COMPOSITION) {
    for (let n = 0; n < count; n += 1) {
      const unitIndex = state.units.spawn(
        faction,
        slot,
        category,
        xs[index] ?? anchor.x,
        ys[index] ?? anchor.y,
      );
      if (unitIndex >= 0) group.members.push(unitIndex);
      index += 1;
    }
  }

  if (group.members.length === 0) {
    // The pool is full; refund rather than registering an empty group.
    player.availableWaves += 1;
    player.wavesDeployed -= 1;
    return undefined;
  }

  group.members.sort((a, b) => a - b);
  group.initialStrength = group.members.length;
  registerGroup(state, group);
  return group;
}
