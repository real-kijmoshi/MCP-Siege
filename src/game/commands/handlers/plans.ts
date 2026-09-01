import { findGroup, nextEntityId, type GameState } from '../../simulation/GameState';
import { describeCondition } from '../../simulation/Conditions';
import { isActiveZone } from '../../simulation/Zones';
import { isZoneId, type BattlePlan, type OrderKind, type PlanStep } from '../../types/domain';
import type {
  CancelPlanPayload,
  CommandResult,
  CreatePlanPayload,
  ExecutePlanPayload,
  GameCommand,
  ModifyPlanPayload,
} from '../types';
import { failure, success } from '../types';
import {
  commitPreparedOrder,
  prepareOrderToGroup,
  type PreparedOrder,
} from './shared';

/**
 * Plan Mode.
 *
 * A plan is inert. Creating or revising one moves nothing on the battlefield;
 * it exists so the commander and the Marshal can agree on an operation and see
 * it drawn over the map before anyone commits. Only `execute_plan` turns steps
 * into orders, and it does so through the ordinary order path.
 */

type DraftStep = Omit<PlanStep, 'id' | 'index'>;

/** Full validation up front, so a plan is never half-valid when it executes. */
function validateStep(
  state: GameState,
  playerId: CreatePlanPayload['playerId'],
  step: DraftStep,
  position: number,
): string | undefined {
  const where = `Step ${position + 1}`;

  const group = findGroup(state, step.groupId);
  if (group === undefined) return `${where}: no group named "${step.groupId}".`;
  if (group.ownerId !== playerId) return `${where}: "${step.groupId}" is not under your command.`;
  if (group.members.length === 0) return `${where}: "${step.groupId}" has been destroyed.`;

  const needsZone =
    step.action === 'move' ||
    step.action === 'attack_zone' ||
    step.action === 'defend_zone';
  if (needsZone) {
    if (step.targetZone === undefined) return `${where}: ${step.action} requires a targetZone.`;
    if (!isZoneId(step.targetZone) || !isActiveZone(step.targetZone)) {
      return `${where}: "${step.targetZone}" is not on this battlefield.`;
    }
  }

  if (step.action === 'attack_group' || step.action === 'support') {
    if (step.targetGroupId === undefined) {
      return `${where}: ${step.action} requires a targetGroupId.`;
    }
    const target = findGroup(state, step.targetGroupId);
    if (step.action === 'support') {
      if (target === undefined || target.ownerId !== playerId || target.members.length === 0) {
        return `${where}: that friendly support target is unavailable.`;
      }
    } else if (
      target === undefined ||
      target.ownerId === playerId ||
      target.members.length === 0 ||
      !state.contacts[playerId].has(step.targetGroupId)
    ) {
      return `${where}: no actionable intelligence is available for that target.`;
    }
  }

  if (step.action === 'change_formation' && step.formation === undefined && step.stance === undefined) {
    return `${where}: change_formation requires a formation or a stance.`;
  }

  const condition = step.startCondition;
  if (condition.kind === 'morale_below' || condition.kind === 'strength_below') {
    const subject = findGroup(state, condition.groupId);
    if (subject === undefined || subject.ownerId !== playerId) {
      return `${where}: condition names a group outside your command.`;
    }
  }
  if (
    (condition.kind === 'enemy_enters_zone' || condition.kind === 'friendly_zone_lost') &&
    (!isZoneId(condition.zoneId) || !isActiveZone(condition.zoneId))
  ) {
    return `${where}: condition names unknown zone "${condition.zoneId}".`;
  }

  return undefined;
}

function materialise(state: GameState, planId: string, steps: DraftStep[]): PlanStep[] {
  return steps.map((step, index) => ({
    ...step,
    id: `${planId}_s${index + 1}`,
    index: index + 1,
  }));
}

/** Renumbers after any structural edit, so ids stay aligned with order. */
function reindex(plan: BattlePlan): void {
  plan.steps = plan.steps.map((step, index) => ({ ...step, index: index + 1 }));
}

export function handleCreatePlan(
  command: GameCommand & CreatePlanPayload,
  state: GameState,
): CommandResult {
  const tick = state.currentTick;

  if (command.steps.length === 0) {
    return failure(command, tick, 'INVALID_INPUT', 'A plan needs at least one step.', []);
  }
  if (command.steps.length > 20) {
    return failure(command, tick, 'INVALID_INPUT', 'A plan is limited to 20 steps.', []);
  }

  for (const [position, step] of command.steps.entries()) {
    const problem = validateStep(state, command.playerId, step, position);
    if (problem !== undefined) {
      return failure(command, tick, 'INVALID_PLAN', problem, [
        'Call get_armies and get_strategic_zones for valid names.',
      ]);
    }
  }

  // Supersede any previous draft so the map never shows two competing plans.
  for (const existing of state.plans) {
    if (existing.status === 'draft') existing.status = 'cancelled';
  }

  const planId = nextEntityId(state, 'plan');
  const plan: BattlePlan = {
    id: planId,
    name: command.name,
    status: 'draft',
    createdAtTick: tick,
    steps: materialise(state, planId, command.steps),
  };
  state.plans.push(plan);

  return success(
    command,
    tick,
    `Plan "${plan.name}" drafted with ${plan.steps.length} step(s). Nothing has moved; call execute_plan to commit it.`,
    { planId, steps: plan.steps.length },
  );
}

export function handleModifyPlan(
  command: GameCommand & ModifyPlanPayload,
  state: GameState,
): CommandResult {
  const tick = state.currentTick;
  const plan = state.plans.find((candidate) => candidate.id === command.planId);

  if (plan === undefined) {
    return failure(command, tick, 'PLAN_NOT_FOUND', `No plan with id "${command.planId}".`, [
      'Call get_plan to see the current draft.',
    ]);
  }
  if (plan.status !== 'draft') {
    return failure(
      command,
      tick,
      'PLAN_NOT_EDITABLE',
      `Plan "${plan.name}" is ${plan.status} and can no longer be edited.`,
      ['Create a new plan, or cancel this one first.'],
    );
  }

  // Validate against a copy so a bad modification cannot leave a mangled plan.
  const draft: BattlePlan = { ...plan, steps: [...plan.steps] };
  let nextSequence = state.entitySequence;

  for (const modification of command.modifications) {
    switch (modification.operation) {
      case 'rename':
        draft.name = modification.name;
        break;

      case 'add_step': {
        const problem = validateStep(state, command.playerId, modification.step, draft.steps.length);
        if (problem !== undefined) return failure(command, tick, 'INVALID_PLAN', problem, []);
        const step: PlanStep = {
          ...modification.step,
          id: `${plan.id}_s${nextSequence}`,
          index: 0,
        };
        nextSequence += 1;
        const at = modification.atIndex ?? draft.steps.length;
        draft.steps.splice(Math.max(0, Math.min(at, draft.steps.length)), 0, step);
        break;
      }

      case 'remove_step': {
        const before = draft.steps.length;
        draft.steps = draft.steps.filter((step) => step.id !== modification.stepId);
        if (draft.steps.length === before) {
          return failure(command, tick, 'STEP_NOT_FOUND', `No step "${modification.stepId}".`, []);
        }
        break;
      }

      case 'replace_step': {
        const position = draft.steps.findIndex((step) => step.id === modification.stepId);
        if (position < 0) {
          return failure(command, tick, 'STEP_NOT_FOUND', `No step "${modification.stepId}".`, []);
        }
        const problem = validateStep(state, command.playerId, modification.step, position);
        if (problem !== undefined) return failure(command, tick, 'INVALID_PLAN', problem, []);
        draft.steps[position] = {
          ...modification.step,
          id: modification.stepId,
          index: position + 1,
        };
        break;
      }

      case 'move_step': {
        const position = draft.steps.findIndex((step) => step.id === modification.stepId);
        if (position < 0) {
          return failure(command, tick, 'STEP_NOT_FOUND', `No step "${modification.stepId}".`, []);
        }
        const [moved] = draft.steps.splice(position, 1);
        if (moved !== undefined) {
          const to = Math.max(0, Math.min(modification.toIndex, draft.steps.length));
          draft.steps.splice(to, 0, moved);
        }
        break;
      }
    }
  }

  if (draft.steps.length === 0) {
    return failure(command, tick, 'INVALID_PLAN', 'A plan must keep at least one step.', []);
  }

  plan.name = draft.name;
  plan.steps = draft.steps;
  state.entitySequence = nextSequence;
  reindex(plan);

  return success(
    command,
    tick,
    `Plan "${plan.name}" revised; ${plan.steps.length} step(s). Still a draft.`,
    { planId: plan.id, steps: plan.steps.length },
  );
}

export function handleExecutePlan(
  command: GameCommand & ExecutePlanPayload,
  state: GameState,
): CommandResult {
  const tick = state.currentTick;
  const plan = state.plans.find((candidate) => candidate.id === command.planId);

  if (plan === undefined) {
    return failure(command, tick, 'PLAN_NOT_FOUND', `No plan with id "${command.planId}".`, [
      'Call get_plan to see the current draft.',
    ]);
  }
  if (plan.status !== 'draft') {
    return failure(command, tick, 'PLAN_NOT_EDITABLE', `Plan "${plan.name}" is already ${plan.status}.`, []);
  }

  const prepared = new Map<string, PreparedOrder>();
  const immediateSteps: PlanStep[] = [];
  const conditionalSteps: PlanStep[] = [];

  // Revalidate the complete plan against the live battlefield before changing
  // anything. A lost regiment or stale target fails the command atomically.
  for (const [position, step] of plan.steps.entries()) {
    const problem = validateStep(state, command.playerId, step, position);
    if (problem !== undefined) {
      return failure(command, tick, 'PLAN_FAILED', problem, [
        'Revise the draft against the current armies and intelligence.',
      ]);
    }
    if (step.startCondition.kind !== 'immediate') {
      conditionalSteps.push(step);
      continue;
    }
    immediateSteps.push(step);
    if (step.action === 'change_formation') continue;

    const group = findGroup(state, step.groupId) as NonNullable<ReturnType<typeof findGroup>>;
    const order = prepareOrderToGroup(state, group, step.action as OrderKind, {
      ...(step.targetZone !== undefined ? { targetZone: step.targetZone } : {}),
      ...(step.targetGroupId !== undefined ? { targetGroupId: step.targetGroupId } : {}),
      ...(step.formation !== undefined ? { formation: step.formation } : {}),
      ...(step.stance !== undefined ? { stance: step.stance } : {}),
    });
    if ('ok' in order) {
      return failure(command, tick, 'PLAN_FAILED', `Step ${step.index}: ${order.summary}`, [
        'Revise the draft against the current armies and intelligence.',
      ]);
    }
    prepared.set(step.id, order);
  }

  if (state.conditionals.length + conditionalSteps.length > 40) {
    return failure(command, tick, 'TOO_MANY_CONDITIONALS', 'The plan would arm too many standing orders.', [
      'Cancel an active conditional or shorten the plan.',
    ]);
  }

  const immediate: string[] = [];
  const armed: string[] = [];
  for (const step of conditionalSteps) {
    state.conditionals.push({
      id: nextEntityId(state, 'cond'),
      planId: plan.id,
      stepId: step.id,
      groupId: step.groupId,
      action: step.action,
      ...(step.targetZone !== undefined ? { targetZone: step.targetZone } : {}),
      ...(step.targetGroupId !== undefined ? { targetGroupId: step.targetGroupId } : {}),
      ...(step.formation !== undefined ? { formation: step.formation } : {}),
      ...(step.stance !== undefined ? { stance: step.stance } : {}),
      condition: step.startCondition,
      createdAtTick: tick,
      note: step.note,
    });
    armed.push(`Step ${step.index} waits ${describeCondition(step.startCondition)}`);
  }

  for (const step of immediateSteps) {
    const group = findGroup(state, step.groupId) as NonNullable<ReturnType<typeof findGroup>>;
    if (step.action === 'change_formation') {
      if (step.formation !== undefined) group.formation = step.formation;
      if (step.stance !== undefined) group.stance = step.stance;
      immediate.push(`${group.name} reforms`);
    } else {
      const order = prepared.get(step.id);
      if (order !== undefined) immediate.push(commitPreparedOrder(state, order).summary);
    }
    state.completedSteps.add(step.id);
  }

  plan.status = 'executing';

  const parts = [`Executing "${plan.name}".`];
  if (immediate.length > 0) parts.push(`${immediate.length} order(s) issued.`);
  if (armed.length > 0) parts.push(`${armed.length} step(s) armed and waiting.`);

  return success(command, tick, parts.join(' '), {
    planId: plan.id,
    steps: plan.steps.length,
  });
}

export function handleCancelPlan(
  command: GameCommand & CancelPlanPayload,
  state: GameState,
): CommandResult {
  const tick = state.currentTick;
  const plan = state.plans.find((candidate) => candidate.id === command.planId);

  if (plan === undefined) {
    return failure(command, tick, 'PLAN_NOT_FOUND', `No plan with id "${command.planId}".`, []);
  }
  if (plan.status === 'cancelled') {
    return failure(command, tick, 'PLAN_NOT_EDITABLE', `Plan "${plan.name}" is already cancelled.`, []);
  }

  plan.status = 'cancelled';
  // Disarm anything still waiting. Orders already issued are deliberately left
  // alone: cancelling a plan is not a recall of troops already marching.
  const before = state.conditionals.length;
  state.conditionals = state.conditionals.filter((pending) => pending.planId !== plan.id);
  const disarmed = before - state.conditionals.length;

  return success(
    command,
    tick,
    `Plan "${plan.name}" cancelled; ${disarmed} pending step(s) disarmed. Orders already issued still stand.`,
    { planId: plan.id },
  );
}
