import { OBJECTIVE, TICKS_PER_SECOND, UNIT_STATS } from '../config/battle';
import {
  PLAYER_IDS,
  opponentOf,
  playerIdOf,
  type KingState,
  type PlayerId,
} from '../types/domain';
import { raiseAlert } from './Alerts';
import { findGroup, type GameState } from './GameState';
import { visibilityAt } from './Visibility';
import { zoneAt } from './Zones';

/**
 * The objective: take the enemy king.
 *
 * Attrition alone settles nothing here. Each side fields a sovereign who rides
 * with his Royal Guard, and the battle is won by holding the ground around the
 * other one long enough to take him. That single rule is what gives every other
 * system a purpose — a flank is worth turning because it opens a road to a
 * king, and a bridge is worth holding because it closes one.
 *
 * A king is deliberately *not* a hero unit. He has no abilities, strikes no
 * blows, occupies no slot in `UnitPool`, and is never addressable as a unit
 * across the WebMCP boundary. He is a position with a name.
 */

/** Scratch, fully overwritten each evaluation. Never carries state across ticks. */
const contest: Record<PlayerId, { friendly: number; hostile: number }> = {
  player: { friendly: 0, hostile: 0 },
  enemy: { friendly: 0, hostile: 0 },
};

export function advanceObjective(state: GameState): void {
  const objective = state.objective;
  if (objective.outcome !== 'ongoing') return;

  // The king rides with his guard, every tick, so the marker never lags the
  // regiment it belongs to. Once the guard is destroyed he is left standing
  // where they fell — which is exactly when he becomes takeable.
  for (const playerId of PLAYER_IDS) {
    const king = objective.kings[playerId];
    const guard = findGroup(state, king.guardGroupId);
    if (guard !== undefined && guard.members.length > 0) {
      king.position.x = guard.anchor.x;
      king.position.y = guard.anchor.y;
      king.guardStrength = guard.members.length;
    } else {
      king.guardStrength = 0;
    }
  }

  if (state.currentTick % OBJECTIVE.interval !== 0) return;

  measureContest(state);

  for (const playerId of PLAYER_IDS) {
    resolveKing(state, objective.kings[playerId], contest[playerId]);
    recordSighting(state, objective.kings[playerId]);
  }

  checkForDecision(state);
}

/** One pass over the army, accumulating who stands within reach of each king. */
function measureContest(state: GameState): void {
  for (const playerId of PLAYER_IDS) {
    contest[playerId].friendly = 0;
    contest[playerId].hostile = 0;
  }

  const units = state.units;
  const radiusSquared = OBJECTIVE.captureRadius * OBJECTIVE.captureRadius;

  for (let index = 0; index < units.count; index += 1) {
    if (units.alive[index] !== 1) continue;
    const x = units.x[index] ?? 0;
    const y = units.y[index] ?? 0;
    const owner = playerIdOf(units.owner[index] ?? 0);
    const value = UNIT_STATS[units.categoryOf(index)].strengthValue;

    for (const playerId of PLAYER_IDS) {
      const king = state.objective.kings[playerId];
      const dx = x - king.position.x;
      const dy = y - king.position.y;
      if (dx * dx + dy * dy > radiusSquared) continue;
      if (owner === playerId) contest[playerId].friendly += value;
      else contest[playerId].hostile += value;
    }
  }
}

function resolveKing(
  state: GameState,
  king: KingState,
  present: { friendly: number; hostile: number },
): void {
  king.defenders = Math.round(present.friendly);
  king.attackers = Math.round(present.hostile);

  // A raiding party has to be substantial before it counts as an attempt, and
  // it has to clearly outweigh the men still standing over him.
  const besieging =
    present.hostile >= OBJECTIVE.minimumAssault &&
    present.hostile > present.friendly * OBJECTIVE.dominance;
  king.besieged = besieging;

  if (besieging) {
    // Overwhelming numbers take him faster, but the rate is capped: no force is
    // large enough to carry a king off before a relief column could arrive.
    const dominance = Math.min(
      OBJECTIVE.maximumRate,
      present.hostile / Math.max(1, present.friendly + OBJECTIVE.minimumAssault),
    );
    king.captureProgress = Math.min(
      100,
      king.captureProgress + OBJECTIVE.progressPerInterval * dominance,
    );
    if (king.captureProgress >= 100) king.captured = true;
  } else {
    king.captureProgress = Math.max(0, king.captureProgress - OBJECTIVE.decayPerInterval);
  }
}

/**
 * Fog applies to kings as it applies to everything else. Each side remembers
 * where it last *saw* the other's sovereign, not where he actually is.
 */
function recordSighting(state: GameState, king: KingState): void {
  const observer = opponentOf(king.ownerId);
  if (visibilityAt(state, observer, king.position.x, king.position.y) !== 2) return;
  king.lastSightingByOpponent = {
    position: { x: king.position.x, y: king.position.y },
    zoneId: zoneAt(king.position.x, king.position.y),
    tick: state.currentTick,
  };
}

/** Living men under a side's command, used to detect a general collapse. */
export function livingStrengthOf(state: GameState, playerId: PlayerId): number {
  let total = 0;
  for (const group of state.groups) {
    if (group.ownerId !== playerId) continue;
    total += group.members.length;
  }
  return total;
}

function checkForDecision(state: GameState): void {
  for (const playerId of PLAYER_IDS) {
    const king = state.objective.kings[playerId];
    if (!king.captured) continue;
    decide(
      state,
      opponentOf(playerId),
      `${king.name} has been taken. The ${state.players[playerId].name} lay down their arms.`,
    );
    return;
  }

  // A field can also simply be lost. Without this the battle could grind to a
  // stalemate that neither side has the strength left to resolve at a base.
  if (state.currentTick < OBJECTIVE.graceSeconds * TICKS_PER_SECOND) return;

  for (const playerId of PLAYER_IDS) {
    const initial = state.objective.initialStrength[playerId];
    if (initial <= 0) continue;
    const remaining = livingStrengthOf(state, playerId);
    if ((remaining / initial) * 100 >= OBJECTIVE.collapsePercent) continue;
    decide(
      state,
      opponentOf(playerId),
      `The ${state.players[playerId].name} are broken — under ${OBJECTIVE.collapsePercent}% of their ` +
        'strength remains, and the field is abandoned.',
    );
    return;
  }
}

function decide(state: GameState, winner: PlayerId, reason: string): void {
  const objective = state.objective;
  objective.outcome = winner === 'player' ? 'player_victory' : 'enemy_victory';
  objective.outcomeReason = reason;
  objective.decidedAtTick = state.currentTick;

  raiseAlert(
    state,
    `objective:decided`,
    'objective',
    winner === 'player' ? 'info' : 'critical',
    winner === 'player' ? `Victory. ${reason}` : `Defeat. ${reason}`,
  );
}

/* ------------------------------------------------------------------ reading */

export function kingOf(state: GameState, playerId: PlayerId): KingState {
  return state.objective.kings[playerId];
}

/** True while this side's own sovereign is being taken. */
export function isOwnKingBesieged(state: GameState, playerId: PlayerId): boolean {
  const king = state.objective.kings[playerId];
  return king.besieged || king.captureProgress > 0;
}

export function battleIsOver(state: GameState): boolean {
  return state.objective.outcome !== 'ongoing';
}
