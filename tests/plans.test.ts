import { beforeEach, describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../src/game/config/battle';
import { GameQueries } from '../src/game/queries/GameQueries';
import { SimulationEngine } from '../src/game/simulation/Engine';
import { activeGroups, findGroup } from '../src/game/simulation/GameState';
import { createWebMcpToolHandlers, type WebMcpToolHandlers } from '../src/integrations/webmcp/tools';

let engine: SimulationEngine;
let tools: WebMcpToolHandlers;

async function call<T>(started: Promise<T>): Promise<T> {
  engine.step();
  return started;
}

function run(ticks: number): void {
  for (let tick = 0; tick < ticks; tick += 1) engine.step();
}

function unwrap(result: unknown): Record<string, unknown> {
  const envelope = result as { success: boolean; data?: unknown; error?: unknown };
  expect(envelope.success, JSON.stringify(envelope.error)).toBe(true);
  return envelope.data as Record<string, unknown>;
}

function expectFailure(result: unknown, code?: string): { code: string; message: string } {
  const envelope = result as { success: boolean; error: { code: string; message: string } };
  expect(envelope.success).toBe(false);
  if (code !== undefined) expect(envelope.error.code).toBe(code);
  return envelope.error;
}

/** The operation used through most of these tests. */
function ironCrossing() {
  return {
    name: 'Operation Iron Crossing',
    steps: [
      {
        groupId: 'vanguard',
        action: 'defend_zone',
        targetZone: 'central_field',
        startCondition: { kind: 'immediate' },
        note: 'Hold the centre.',
      },
      {
        groupId: 'greyriders',
        action: 'move',
        // Ground the Grey Riders do not already stand on: an order to march
        // where a regiment is standing is answered with hold, correctly.
        targetZone: 'village',
        startCondition: { kind: 'immediate' },
        note: 'Move up through the village.',
      },
      {
        groupId: 'greyriders',
        action: 'attack_zone',
        targetZone: 'west_crossing',
        startCondition: { kind: 'timer_elapsed', seconds: 20 },
        note: 'Sweep the ford once the centre is committed.',
      },
      {
        groupId: 'kingsguard',
        action: 'support',
        targetGroupId: 'vanguard',
        startCondition: { kind: 'morale_below', groupId: 'vanguard', value: 60 },
        note: 'Commit the reserve if the centre wavers.',
      },
    ],
  };
}

beforeEach(() => {
  engine = new SimulationEngine(11);
  const queries = new GameQueries(() => engine.getState());
  tools = createWebMcpToolHandlers({ engine, queries });
});

describe('plan mode', () => {
  it('drafts a plan without moving a single soldier', async () => {
    const state = engine.getState();
    const before = activeGroups(state, 'player').map((group) => ({
      id: group.id,
      x: group.anchor.x,
      y: group.anchor.y,
      order: group.order.kind,
      path: group.path.length,
    }));

    const data = unwrap(await call(tools.createPlan(ironCrossing())));
    expect(data.steps).toBe(4);
    expect(String(data.summary)).toContain('Nothing has moved');

    // The decisive assertion of Plan Mode: drafting is inert.
    for (const snapshot of before) {
      const group = findGroup(state, snapshot.id);
      expect(group?.anchor.x).toBe(snapshot.x);
      expect(group?.anchor.y).toBe(snapshot.y);
      expect(group?.order.kind).toBe(snapshot.order);
      expect(group?.path.length).toBe(snapshot.path);
    }
    expect(state.conditionals).toHaveLength(0);
  });

  it('rejects a plan that names a group that does not exist', async () => {
    const error = expectFailure(
      await call(
        tools.createPlan({
          name: 'Bad Plan',
          steps: [
            {
              groupId: 'ghost_legion',
              action: 'move',
              targetZone: 'central_field',
              startCondition: { kind: 'immediate' },
              note: 'Nope.',
            },
          ],
        }),
      ),
      'INVALID_PLAN',
    );
    expect(error.message).toContain('ghost_legion');
  });

  it('rejects an assault step with no destination', async () => {
    expectFailure(
      await call(
        tools.createPlan({
          name: 'Vague Plan',
          steps: [
            {
              groupId: 'vanguard',
              action: 'attack_zone',
              startCondition: { kind: 'immediate' },
              note: 'Attack something.',
            },
          ],
        }),
        ),
      'INVALID_PLAN',
    );
  });

  it('revises a draft and leaves it a draft', async () => {
    const created = unwrap(await call(tools.createPlan(ironCrossing())));
    const planId = String(created.planId);

    const plan = unwrap(tools.getPlan()).plan as { steps: Array<{ id: string }> };
    const secondStepId = plan.steps[1]?.id ?? '';

    const revised = unwrap(
      await call(
        tools.modifyPlan({
          planId,
          modifications: [
            {
              operation: 'replace_step',
              stepId: secondStepId,
              step: {
                groupId: 'greyriders',
                action: 'move',
                // The commander asks for the cavalry to swing further west.
                targetZone: 'west_crossing',
                startCondition: { kind: 'immediate' },
                note: 'Swing wider through the ford.',
              },
            },
            { operation: 'rename', name: 'Operation Wide Hook' },
          ],
        }),
      ),
    );

    expect(String(revised.summary)).toContain('Still a draft');

    const after = unwrap(tools.getPlan()).plan as {
      name: string;
      status: string;
      steps: Array<{ target: string }>;
    };
    expect(after.name).toBe('Operation Wide Hook');
    expect(after.status).toBe('draft');
    expect(after.steps[1]?.target).toBe('West Crossing');
    expect(engine.getState().conditionals).toHaveLength(0);
  });

  it('executes immediate steps and arms the conditional ones', async () => {
    const created = unwrap(await call(tools.createPlan(ironCrossing())));
    const planId = String(created.planId);

    const executed = unwrap(await call(tools.executePlan({ planId })));
    expect(String(executed.summary)).toContain('Executing');

    const state = engine.getState();
    // Two steps were immediate, two were gated.
    expect(findGroup(state, 'vanguard')?.order.kind).toBe('defend_zone');
    expect(findGroup(state, 'greyriders')?.order.kind).toBe('move');
    expect(state.conditionals).toHaveLength(2);

    // The reserve has not moved: its trigger has not been met.
    expect(findGroup(state, 'kingsguard')?.order.kind).toBe('idle');
  });

  it('refuses to execute the same plan twice', async () => {
    const created = unwrap(await call(tools.createPlan(ironCrossing())));
    const planId = String(created.planId);
    unwrap(await call(tools.executePlan({ planId })));
    expectFailure(await call(tools.executePlan({ planId })), 'PLAN_NOT_EDITABLE');
  });

  it('cancelling disarms pending steps but does not recall marching troops', async () => {
    const created = unwrap(await call(tools.createPlan(ironCrossing())));
    const planId = String(created.planId);
    unwrap(await call(tools.executePlan({ planId })));

    const state = engine.getState();
    expect(state.conditionals).toHaveLength(2);

    unwrap(await call(tools.cancelPlan({ planId })));

    expect(state.conditionals).toHaveLength(0);
    // Orders already issued still stand.
    expect(findGroup(state, 'greyriders')?.order.kind).toBe('move');
  });
});

describe('conditional orders', () => {
  it('fires a timed step exactly once, on time', async () => {
    const created = unwrap(await call(tools.createPlan(ironCrossing())));
    unwrap(await call(tools.executePlan({ planId: String(created.planId) })));

    const state = engine.getState();
    const cavalryOrderBefore = findGroup(state, 'greyriders')?.order.kind;
    expect(cavalryOrderBefore).toBe('move');

    run(TICKS_PER_SECOND * 25);

    expect(findGroup(state, 'greyriders')?.order.kind).toBe('attack_zone');
    expect(findGroup(state, 'greyriders')?.order.targetZone).toBe('west_crossing');
    // The timed conditional is consumed; only the morale one remains.
    expect(state.conditionals).toHaveLength(1);
    expect(state.conditionals[0]?.condition.kind).toBe('morale_below');
  });

  it('arms a standing order and reports it through get_active_orders', async () => {
    unwrap(
      await call(
        tools.setConditionalOrder({
          groupId: 'ironbacks',
          action: 'retreat',
          condition: { kind: 'morale_below', groupId: 'ironbacks', value: 25 },
          note: 'Pull back before it breaks.',
        }),
      ),
    );

    const orders = unwrap(tools.getActiveOrders());
    const conditionals = orders.conditionalOrders as Array<{ trigger: string; groupId: string }>;
    expect(conditionals).toHaveLength(1);
    expect(conditionals[0]?.groupId).toBe('ironbacks');
    expect(conditionals[0]?.trigger).toContain('morale');
  });

  it('rejects an immediate condition on a standing order', async () => {
    expectFailure(
      await call(
        tools.setConditionalOrder({
          groupId: 'ironbacks',
          action: 'retreat',
          condition: { kind: 'immediate' },
          note: 'This should be an order, not a trigger.',
        }),
      ),
      'INVALID_INPUT',
    );
  });

  it('rejects a condition naming an unknown zone', async () => {
    expectFailure(
      await call(
        tools.setConditionalOrder({
          groupId: 'ironbacks',
          action: 'retreat',
          condition: { kind: 'friendly_zone_lost', zoneId: 'atlantis' },
          note: 'Nope.',
        }),
      ),
      'INVALID_INPUT',
    );
  });

  it('cancels a standing order before it fires', async () => {
    const armed = unwrap(
      await call(
        tools.setConditionalOrder({
          groupId: 'ironbacks',
          action: 'retreat',
          condition: { kind: 'timer_elapsed', seconds: 600 },
          note: 'Late withdrawal.',
        }),
      ),
    );

    unwrap(await call(tools.cancelConditionalOrder({ conditionalId: String(armed.conditionalId) })));
    expect(engine.getState().conditionals).toHaveLength(0);
  });
});

