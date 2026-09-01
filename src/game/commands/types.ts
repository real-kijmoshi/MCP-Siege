import type {
  Formation,
  OrderKind,
  PlanAction,
  PlanCondition,
  PlanStep,
  PlayerId,
  Stance,
  Vector2D,
  ZoneId,
} from '../types/domain';

/**
 * Every mutation of the battle crosses this contract.
 *
 * Human input, the external Marshal over WebMCP, and the enemy AI all produce
 * the same command shapes and share one deterministic queue. There is no
 * privileged path: a WebMCP order is validated exactly like a mouse click.
 */

export type CommandSource = 'human' | 'webmcp' | 'enemy_ai' | 'conditional' | 'debug';

export interface CommandContext {
  source: CommandSource;
  issuedAtTick: number;
  sequence: number;
}

/** Move, attack, defend, hold, retreat or scout with one or more groups. */
export interface OrderGroupsPayload {
  type: 'order_groups';
  playerId: PlayerId;
  groupIds: string[];
  order: OrderKind;
  targetZone?: ZoneId;
  targetGroupId?: string;
  destination?: Vector2D;
  formation?: Formation;
  stance?: Stance;
  /** Append this destination after the group's existing march instead of replacing it. */
  append?: boolean;
}

export interface ChangeFormationPayload {
  type: 'change_formation';
  playerId: PlayerId;
  groupIds: string[];
  formation?: Formation;
  stance?: Stance;
}

export interface SplitGroupPayload {
  type: 'split_group';
  playerId: PlayerId;
  groupId: string;
  /** Portion of the source group moved into the new group, 1-99. */
  percent: number;
  newGroupName: string;
}

export interface MergeGroupsPayload {
  type: 'merge_groups';
  playerId: PlayerId;
  groupIds: string[];
  newGroupName?: string;
}

export interface RenameGroupPayload {
  type: 'rename_group';
  playerId: PlayerId;
  groupId: string;
  name: string;
}

export interface SetConditionalOrderPayload {
  type: 'set_conditional_order';
  playerId: PlayerId;
  groupId: string;
  action: PlanAction;
  targetZone?: ZoneId;
  targetGroupId?: string;
  formation?: Formation;
  stance?: Stance;
  condition: PlanCondition;
  note: string;
}

export interface CancelConditionalOrderPayload {
  type: 'cancel_conditional_order';
  playerId: PlayerId;
  conditionalId: string;
}

export interface FocusSiegePayload {
  type: 'focus_siege';
  playerId: PlayerId;
  siegeGroupId: string;
  targetZone: ZoneId;
}

export interface DirectReinforcementsPayload {
  type: 'direct_reinforcements';
  playerId: PlayerId;
  targetGroupId?: string;
  targetZone?: ZoneId;
}

/* ------------------------------------------------------------------ plans */

export interface CreatePlanPayload {
  type: 'create_plan';
  playerId: PlayerId;
  name: string;
  steps: Array<Omit<PlanStep, 'id' | 'index'>>;
}

export type PlanModification =
  | { operation: 'add_step'; step: Omit<PlanStep, 'id' | 'index'>; atIndex?: number }
  | { operation: 'remove_step'; stepId: string }
  | { operation: 'replace_step'; stepId: string; step: Omit<PlanStep, 'id' | 'index'> }
  | { operation: 'move_step'; stepId: string; toIndex: number }
  | { operation: 'rename'; name: string };

export interface ModifyPlanPayload {
  type: 'modify_plan';
  playerId: PlayerId;
  planId: string;
  modifications: PlanModification[];
}

export interface ExecutePlanPayload {
  type: 'execute_plan';
  playerId: PlayerId;
  planId: string;
}

export interface CancelPlanPayload {
  type: 'cancel_plan';
  playerId: PlayerId;
  planId: string;
}

export type GameCommandPayload =
  | OrderGroupsPayload
  | ChangeFormationPayload
  | SplitGroupPayload
  | MergeGroupsPayload
  | RenameGroupPayload
  | SetConditionalOrderPayload
  | CancelConditionalOrderPayload
  | FocusSiegePayload
  | DirectReinforcementsPayload
  | CreatePlanPayload
  | ModifyPlanPayload
  | ExecutePlanPayload
  | CancelPlanPayload;

export type GameCommand = GameCommandPayload & CommandContext & { id: string };

export interface CommandResultData {
  warnings: string[];
  groupIds?: string[];
  planId?: string;
  conditionalId?: string;
  newGroupId?: string;
  affectedUnits?: number;
  steps?: number;
}

export interface CommandSuccess {
  ok: true;
  commandId: string;
  appliedAtTick: number;
  summary: string;
  data: CommandResultData;
}

export interface CommandFailure {
  ok: false;
  commandId: string;
  appliedAtTick: number;
  code: string;
  message: string;
  suggestions: string[];
}

export type CommandResult = CommandSuccess | CommandFailure;

export function success(
  command: GameCommand,
  tick: number,
  summary: string,
  data: Partial<CommandResultData> = {},
): CommandSuccess {
  return {
    ok: true,
    commandId: command.id,
    appliedAtTick: tick,
    summary,
    data: { warnings: [], ...data },
  };
}

export function failure(
  command: GameCommand,
  tick: number,
  code: string,
  message: string,
  suggestions: string[] = [],
): CommandFailure {
  return { ok: false, commandId: command.id, appliedAtTick: tick, code, message, suggestions };
}
