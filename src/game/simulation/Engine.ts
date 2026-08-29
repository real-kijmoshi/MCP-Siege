import { buildScenario } from '../config/scenario';
import { CommandQueue } from '../commands/CommandQueue';
import {
  handleCancelConditionalOrder,
  handleSetConditionalOrder,
} from '../commands/handlers/conditionals';
import {
  handleChangeFormation,
  handleDirectReinforcements,
  handleFocusSiege,
  handleOrderGroups,
} from '../commands/handlers/groupOrders';
import {
  handleCancelPlan,
  handleCreatePlan,
  handleExecutePlan,
  handleModifyPlan,
} from '../commands/handlers/plans';
import {
  handleMergeGroups,
  handleRenameGroup,
  handleSplitGroup,
} from '../commands/handlers/reorganize';
import {
  failure,
  type CommandResult,
  type CommandSource,
  type GameCommand,
  type GameCommandPayload,
} from '../commands/types';
import { advanceAlerts, resetAlertTracking } from './Alerts';
import { advanceCombat } from './Combat';
import { collectTriggeredOrders } from './Conditions';
import { createEmptyState, type GameState } from './GameState';
import { advanceMorale } from './Morale';
import { advanceMovement } from './Movement';
import { advanceObjective } from './Objective';
import { advanceReinforcements } from './Reinforcements';
import { advanceVisibility, seedInitialVisibility } from './Visibility';
import { advanceZoneControl, seedZoneControl } from './ZoneControl';
import { enemyAiCommands } from './EnemyAi';

export type CommandResultListener = (command: GameCommand, result: CommandResult) => void;

/**
 * The simulation.
 *
 * It owns the only mutable game state in the application. Human input, the
 * external Marshal and the enemy AI all reach it through `dispatch`, and
 * nothing else may write. Systems run in a fixed order every tick and never
 * consult wall-clock time, so a seed and a command log fully determine a battle.
 */
export class SimulationEngine {
  private readonly state: GameState;
  private readonly queue = new CommandQueue();
  private readonly resultListeners = new Set<CommandResultListener>();
  private readonly results = new Map<string, CommandResult>();

  public constructor(seed = 20_260_829) {
    this.state = createEmptyState(seed);
    buildScenario(this.state);
    seedInitialVisibility(this.state);
    seedZoneControl(this.state);
    resetAlertTracking(this.state);
  }

  public dispatch(source: CommandSource, payload: GameCommandPayload): GameCommand {
    const sequence = this.state.commandSequence;
    this.state.commandSequence += 1;
    const command: GameCommand = {
      ...payload,
      id: `cmd_${sequence}`,
      source,
      issuedAtTick: this.state.currentTick,
      sequence,
    };
    this.queue.enqueue(command);
    return command;
  }

  public step(): CommandResult[] {
    this.state.currentTick += 1;

    // A taken king ends the battle. The clock keeps running so the page can
    // still animate and report, but nothing manoeuvres and no order is
    // accepted; anything already queued is failed rather than left pending, so
    // a Marshal call cannot hang waiting on a result that will never come.
    if (this.state.objective.outcome !== 'ongoing') return this.rejectQueuedCommands();

    // The enemy and any conditional that just came true submit ordinary
    // commands, which land alongside the player's in the same ordered queue.
    for (const payload of enemyAiCommands(this.state)) this.dispatch('enemy_ai', payload);
    for (const payload of collectTriggeredOrders(this.state)) this.dispatch('conditional', payload);

    const tickResults: CommandResult[] = [];
    for (const command of this.queue.drainReady(this.state.currentTick)) {
      const result = this.applyCommand(command);
      this.results.set(command.id, result);
      if (this.results.size > 400) {
        const oldest = this.results.keys().next().value;
        if (oldest !== undefined) this.results.delete(oldest);
      }
      tickResults.push(result);
      for (const listener of this.resultListeners) listener(command, result);
    }

    advanceMovement(this.state);
    advanceCombat(this.state);
    advanceMorale(this.state);
    advanceVisibility(this.state);
    advanceZoneControl(this.state);
    advanceObjective(this.state);
    advanceReinforcements(this.state);
    advanceAlerts(this.state);
    this.pruneCombatEvents();

    return tickResults;
  }

  /**
   * Direct, read-only access to live state.
   *
   * The renderer reads through this every frame; cloning thousands of units at
   * sixty frames a second is not affordable, so the contract is enforced by
   * convention and by the read-only view types rather than by copying.
   * WebMCP never sees this: it goes through `GameQueries` projections.
   */
  public getState(): GameState {
    return this.state;
  }

  public getCommandResult(commandId: string): CommandResult | undefined {
    return this.results.get(commandId);
  }

  public onCommandResult(listener: CommandResultListener): () => void {
    this.resultListeners.add(listener);
    return () => this.resultListeners.delete(listener);
  }

  public get pendingCommandCount(): number {
    return this.queue.size;
  }

  /** Answers every outstanding command once the battle has been decided. */
  private rejectQueuedCommands(): CommandResult[] {
    const results: CommandResult[] = [];
    for (const command of this.queue.drainReady(this.state.currentTick)) {
      const result = failure(
        command,
        this.state.currentTick,
        'BATTLE_OVER',
        this.state.objective.outcomeReason,
        ['The battle is decided. No further orders can be given.'],
      );
      this.results.set(command.id, result);
      results.push(result);
      for (const listener of this.resultListeners) listener(command, result);
    }
    return results;
  }

  private pruneCombatEvents(): void {
    const events = this.state.combatEvents;
    const cutoff = this.state.currentTick - 6;
    let index = 0;
    while (index < events.length && (events[index]?.tick ?? 0) < cutoff) index += 1;
    if (index > 0) events.splice(0, index);
  }

  private applyCommand(command: GameCommand): CommandResult {
    switch (command.type) {
      case 'order_groups':
        return handleOrderGroups(command, this.state);
      case 'change_formation':
        return handleChangeFormation(command, this.state);
      case 'split_group':
        return handleSplitGroup(command, this.state);
      case 'merge_groups':
        return handleMergeGroups(command, this.state);
      case 'rename_group':
        return handleRenameGroup(command, this.state);
      case 'set_conditional_order':
        return handleSetConditionalOrder(command, this.state);
      case 'cancel_conditional_order':
        return handleCancelConditionalOrder(command, this.state);
      case 'focus_siege':
        return handleFocusSiege(command, this.state);
      case 'direct_reinforcements':
        return handleDirectReinforcements(command, this.state);
      case 'create_plan':
        return handleCreatePlan(command, this.state);
      case 'modify_plan':
        return handleModifyPlan(command, this.state);
      case 'execute_plan':
        return handleExecutePlan(command, this.state);
      case 'cancel_plan':
        return handleCancelPlan(command, this.state);
    }
  }
}
