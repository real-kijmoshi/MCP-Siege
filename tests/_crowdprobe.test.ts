import { describe, it } from 'vitest';
import { TICKS_PER_SECOND } from '../src/game/config/battle';
import { SimulationEngine } from '../src/game/simulation/Engine';
import { activeGroups } from '../src/game/simulation/GameState';
import { livingStrengthOf } from '../src/game/simulation/Objective';
import type { Formation, Stance, ZoneId } from '../src/game/types/domain';

/**
 * Balance recorder for the press, exhaustion and the crossing.
 *
 * Output only, and deliberately long: it plays two whole battles per seed so the
 * question the whole workstream exists to answer can be read off a run rather
 * than argued about. That question is whether putting the entire army through
 * one bridge is still simply correct. It should now cost most of the army and
 * lose about as often as it wins, while a commander who holds a line and keeps
 * his king covered does better.
 *
 * Excluded from the default suite; run it with `npm run test:balance`.
 */

interface Result {
  label: string;
  seed: number;
  seconds: number;
  player: number;
  enemy: number;
  outcome: string;
}

function finish(engine: SimulationEngine, label: string, seed: number): Result {
  const state = engine.getState();
  return {
    label,
    seed,
    seconds: Math.round(state.currentTick / TICKS_PER_SECOND),
    player: livingStrengthOf(state, 'player'),
    enemy: livingStrengthOf(state, 'enemy'),
    outcome: state.objective.outcome,
  };
}

function log(result: Result): void {
  console.log(
    `${result.label.padEnd(8)} seed=${result.seed} end=${result.seconds}s ` +
      `player=${result.player} enemy=${result.enemy} ${result.outcome}`,
  );
}

const LIMIT = TICKS_PER_SECOND * 900;

/** Everything at the central bridge, then straight on at the enemy king. */
function rush(seed: number): Result {
  const engine = new SimulationEngine({ seed });
  for (let tick = 0; tick < LIMIT; tick += 1) {
    const state = engine.getState();
    if (state.currentTick % (TICKS_PER_SECOND * 30) === 0) {
      const groupIds = activeGroups(state, 'player')
        .filter((group) => group.id !== 'royal_guard' && !group.routing)
        .map((group) => group.id);
      if (groupIds.length > 0) {
        engine.dispatch('human', {
          type: 'order_groups',
          playerId: 'player',
          groupIds,
          order: 'attack_zone',
          targetZone: state.currentTick < TICKS_PER_SECOND * 150 ? 'central_bridge' : 'enemy_base',
        });
      }
    }
    engine.step();
    if (engine.getState().objective.outcome !== 'ongoing') break;
  }
  return finish(engine, 'RUSH', seed);
}

/** A line in the centre, bows on the hill, and horse held back for the king. */
function defence(seed: number): Result {
  const engine = new SimulationEngine({ seed });
  const hold = (
    groupIds: string[],
    targetZone: ZoneId,
    formation?: Formation,
    stance?: Stance,
  ): void => {
    engine.dispatch('human', {
      type: 'order_groups',
      playerId: 'player',
      groupIds,
      order: 'defend_zone',
      targetZone,
      ...(formation === undefined ? {} : { formation }),
      ...(stance === undefined ? {} : { stance }),
    });
  };

  hold(['legion_i'], 'central_field', 'line', 'hold_ground');
  hold(['spearwall'], 'central_field', 'double_line', 'hold_ground');
  hold(['legion_ii'], 'central_field', 'line', 'defensive');
  hold(['archers_i'], 'central_hill', 'loose', 'defensive');
  hold(['siege_corps'], 'central_hill', undefined, 'defensive');
  hold(['reserve_i'], 'player_base', 'block', 'hold_ground');
  hold(['cavalry_i', 'cavalry_ii'], 'player_base', 'wedge', 'defensive');

  let answering = false;
  for (let tick = 0; tick < LIMIT; tick += 1) {
    const state = engine.getState();
    if (state.currentTick % (TICKS_PER_SECOND * 20) === 0) {
      const beset = state.objective.kings.player.attackers > 0;
      if (beset && !answering) {
        answering = true;
        hold(['cavalry_i', 'cavalry_ii'], 'player_base', 'wedge', 'aggressive');
      } else if (!beset) {
        answering = false;
      }
    }
    engine.step();
    if (engine.getState().objective.outcome !== 'ongoing') break;
  }
  return finish(engine, 'DEFENCE', seed);
}

describe('balance', () => {
  it('records a doomstack rush against a measured defence', () => {
    for (const seed of [11, 22, 33]) {
      log(rush(seed));
      log(defence(seed));
    }
  }, 600_000);
});
