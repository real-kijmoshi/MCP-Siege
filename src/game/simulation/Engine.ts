import { CommandQueue } from '../commands/CommandQueue';
import { handleAssignWorkers } from '../commands/handlers/assignWorkers';
import { handleMoveUnits } from '../commands/handlers/moveUnits';
import {
  handleAttackTarget,
  handleGatherResource,
  handlePlaceBuilding,
  handleResearchUpgrade,
  handleTrainUnit,
} from '../commands/handlers/gameplay';
import type {
  CommandResult,
  CommandSource,
  GameCommand,
  GameCommandPayload,
} from '../commands/types';
import { cloneGameState, createInitialGameState, type GameSnapshot, type GameState } from './GameState';
import {
  advanceCombat,
  advanceConstruction,
  advanceGathering,
  advanceMovement,
  advanceProduction,
  enemyAiCommands,
} from './Systems';

export type CommandResultListener = (command: GameCommand, result: CommandResult) => void;

export class SimulationEngine {
  private readonly state: GameState;
  private readonly queue = new CommandQueue();
  private readonly resultListeners = new Set<CommandResultListener>();
  private readonly results = new Map<string, CommandResult>();

  public constructor(seed = 13_371) {
    this.state = createInitialGameState(seed);
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
    return structuredClone(command);
  }

  public step(): CommandResult[] {
    this.state.currentTick += 1;
    for (const payload of enemyAiCommands(this.state)) this.dispatch('enemy_ai', payload);
    const tickResults: CommandResult[] = [];
    for (const command of this.queue.drainReady(this.state.currentTick)) {
      const result = this.applyCommand(command);
      this.state.commandLog.push({ command: structuredClone(command), result: structuredClone(result) });
      if (this.state.commandLog.length > 200) this.state.commandLog.shift();
      this.results.set(command.id, structuredClone(result));
      tickResults.push(structuredClone(result));
      for (const listener of this.resultListeners) listener(structuredClone(command), structuredClone(result));
    }
    advanceMovement(this.state);
    advanceGathering(this.state);
    advanceConstruction(this.state);
    advanceProduction(this.state);
    advanceCombat(this.state);
    return tickResults;
  }

  public getSnapshot(): GameSnapshot {
    return cloneGameState(this.state);
  }

  public getCommandResult(commandId: string): CommandResult | undefined {
    const result = this.results.get(commandId);
    return result === undefined ? undefined : structuredClone(result);
  }

  public onCommandResult(listener: CommandResultListener): () => void {
    this.resultListeners.add(listener);
    return () => this.resultListeners.delete(listener);
  }

  public get pendingCommandCount(): number {
    return this.queue.size;
  }

  private applyCommand(command: GameCommand): CommandResult {
    switch (command.type) {
      case 'assign_workers':
        return handleAssignWorkers(command, this.state);
      case 'move_units':
        return handleMoveUnits(command, this.state);
      case 'gather_resource':
        return handleGatherResource(command, this.state);
      case 'place_building':
        return handlePlaceBuilding(command, this.state);
      case 'train_unit':
        return handleTrainUnit(command, this.state);
      case 'research_upgrade':
        return handleResearchUpgrade(command, this.state);
      case 'attack_target':
        return handleAttackTarget(command, this.state);
    }
  }
}
