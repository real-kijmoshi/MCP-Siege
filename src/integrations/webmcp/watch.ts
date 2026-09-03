import { TICKS_PER_SECOND } from '../../game/config/battle';
import { describeCondition } from '../../game/simulation/Conditions';
import type { SimulationEngine } from '../../game/simulation/Engine';
import type { GameQueries } from '../../game/queries/GameQueries';
import type { ChangeDigest } from '../../game/queries/Changes';
import type { PlanCondition, PlayerId } from '../../game/types/domain';

/**
 * Waiting on the battle instead of polling it.
 *
 * The fight runs at twenty ticks a second and a Marshal takes seconds to
 * think, so every previous exchange went: read, order, and then guess how long
 * to wait before reading again. Too short and the agent burned its turn on a
 * picture that had not changed; too long and it learned about a broken wing
 * from the casualty list. There was no way to say "tell me when the enemy
 * reaches the bridge" — the trigger vocabulary existed, but it could only fire
 * an *order*, never a report.
 *
 * This hands the same closed vocabulary to a wait. The call resolves the
 * moment one of the named conditions holds, or when the battle time the caller
 * budgeted has run out, and it comes back with what changed while it waited.
 * Time is counted in ticks rather than milliseconds, so pausing the game
 * pauses the wait rather than expiring it, and a paused game is reported as
 * paused rather than left to hang.
 */

/** Conditions a single wait may name. */
export const MAXIMUM_WATCH_CONDITIONS = 4;
/** Bounds on the battle time a wait may cover, in seconds. */
export const MINIMUM_WATCH_SECONDS = 2;
export const MAXIMUM_WATCH_SECONDS = 180;

/** No tick for this long means the game is paused, not merely quiet. */
const STALL_MS = 5000;

export type WatchStatus = 'fired' | 'timeout' | 'battle_over' | 'paused';

export interface WatchRequest {
  conditions: readonly PlanCondition[];
  timeoutSeconds: number;
}

export interface WatchResult {
  status: WatchStatus;
  /** Battle seconds actually waited. */
  waitedSeconds: number;
  /** The condition that ended the wait, if one did. */
  fired?: { index: number; kind: string; description: string };
  /** True when the condition was already true before the wait began. */
  alreadyTrue: boolean;
  watching: string[];
  changes: ChangeDigest;
  attention: string[];
  note: string;
}

const STATUS_NOTE: Record<WatchStatus, string> = {
  fired: 'A condition you named came true. Everything below happened while you waited.',
  timeout:
    'Nothing you named happened inside the time you allowed. That is information: the fight is going ' +
    'as it was. Read the changes, then either wait longer or act.',
  battle_over: 'The battle has been decided. No further order will be accepted.',
  paused:
    'The battle is not running — the commander has paused it. Nothing was missed; call again once it resumes.',
};

export function createBattleWatch(
  engine: SimulationEngine,
  queries: GameQueries,
  playerId: PlayerId,
) {
  return async function watchBattle(request: WatchRequest): Promise<WatchResult> {
    const armedAtTick = queries.currentTick();
    const before = queries.snapshot(playerId);
    const watching = request.conditions.map(describeCondition);

    const finish = (
      status: WatchStatus,
      firedIndex: number,
      alreadyTrue: boolean,
    ): WatchResult => {
      const result: WatchResult = {
        status,
        waitedSeconds: Math.round((queries.currentTick() - armedAtTick) / TICKS_PER_SECOND),
        alreadyTrue,
        watching,
        changes: queries.changesSince(playerId, before),
        attention: queries.getBattleOverview(playerId).attention,
        note: STATUS_NOTE[status],
      };
      const condition = request.conditions[firedIndex];
      if (condition !== undefined) {
        result.fired = {
          index: firedIndex,
          kind: condition.kind,
          description: describeCondition(condition),
        };
      }
      return result;
    };

    if (queries.battleOutcome() !== 'ongoing') return finish('battle_over', -1, false);

    // Something already true is answered at once rather than waited out. Saying
    // so matters: "it fired instantly" and "it fired after twenty seconds" are
    // different pieces of information about the same battle.
    for (let index = 0; index < request.conditions.length; index += 1) {
      const condition = request.conditions[index];
      if (condition !== undefined && queries.conditionHolds(playerId, condition, armedAtTick)) {
        return finish('fired', index, true);
      }
    }

    const budgetTicks = Math.round(request.timeoutSeconds * TICKS_PER_SECOND);

    const outcome = await new Promise<{ status: WatchStatus; index: number }>((resolve) => {
      let settled = false;
      let stallTimer: ReturnType<typeof setTimeout> | undefined;

      const settle = (status: WatchStatus, index: number): void => {
        if (settled) return;
        settled = true;
        if (stallTimer !== undefined) clearTimeout(stallTimer);
        unsubscribe();
        resolve({ status, index });
      };

      // Only ever armed against a game that has stopped ticking. It is reset by
      // every tick, so a slow battle is never mistaken for a paused one.
      const armStallTimer = (): void => {
        if (stallTimer !== undefined) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => settle('paused', -1), STALL_MS);
      };

      const unsubscribe = engine.onTick(() => {
        if (settled) return;
        armStallTimer();

        if (queries.battleOutcome() !== 'ongoing') {
          settle('battle_over', -1);
          return;
        }
        for (let index = 0; index < request.conditions.length; index += 1) {
          const condition = request.conditions[index];
          if (condition !== undefined && queries.conditionHolds(playerId, condition, armedAtTick)) {
            settle('fired', index);
            return;
          }
        }
        if (queries.currentTick() - armedAtTick >= budgetTicks) settle('timeout', -1);
      });

      armStallTimer();
    });

    return finish(outcome.status, outcome.index, false);
  };
}
