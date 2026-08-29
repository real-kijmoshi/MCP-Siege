import { beforeEach, describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/game/simulation/Engine';
import { GameQueries } from '../src/game/queries/GameQueries';
import { createWebMcpToolHandlers, type WebMcpToolHandlers } from '../src/integrations/webmcp/tools';
import { registerWebMcpTools } from '../src/integrations/webmcp/registry';
import { activeGroups } from '../src/game/simulation/GameState';
import { TICKS_PER_SECOND } from '../src/game/config/battle';

let engine: SimulationEngine;
let tools: WebMcpToolHandlers;

/**
 * Commands resolve on the next tick, so a tool call is started, the engine is
 * advanced, and only then is the promise awaited.
 */
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

beforeEach(() => {
  engine = new SimulationEngine(7);
  const queries = new GameQueries(() => engine.getState());
  tools = createWebMcpToolHandlers({ engine, queries });
});

describe('registration', () => {
  it('registers every tool through document.modelContext', async () => {
    const registered: string[] = [];
    const result = await registerWebMcpTools(tools, {
      registerTool: async (tool: { name: string }) => {
        registered.push(tool.name);
      },
    } as never);

    expect(result.status).toBe('connected');
    expect(registered).toContain('get_battle_overview');
    expect(registered).toContain('create_plan');
    expect(registered).toContain('execute_plan');
    expect(registered).toContain('order_group');
    expect(registered).toContain('set_conditional_order');
    expect(new Set(registered).size).toBe(registered.length);
  });

  it('reports unavailability rather than throwing when the API is absent', async () => {
    const result = await registerWebMcpTools(tools, undefined);
    expect(result.status).toBe('unavailable');
  });
});

describe('reads', () => {
  it('returns a strategic overview rather than a state dump', () => {
    const data = unwrap(tools.getBattleOverview());
    expect(data.playerUnits).toBeGreaterThan(3000);
    expect(data.fronts).toBeTruthy();
    expect(JSON.stringify(data).length).toBeLessThan(2000);
  });

  it('lists armies with the ids that commands accept', () => {
    const data = unwrap(tools.getArmies());
    const armies = data.armies as Array<{ id: string; name: string }>;
    expect(armies.map((army) => army.id)).toContain('legion_i');
    expect(armies.every((army) => army.name.length > 0)).toBe(true);
  });

  it('rejects unknown parameters on a strict schema', () => {
    const error = expectFailure(tools.getArmyDetails({ groupId: 'legion_i', extra: 1 }));
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.message).toContain('extra');
  });

  it('refuses to describe a group that is not yours', () => {
    expectFailure(tools.getArmyDetails({ groupId: 'iron_host' }), 'GROUP_NOT_FOUND');
  });
});

describe('fog of war', () => {
  it('never reports an enemy group the player has not seen', () => {
    const data = unwrap(tools.getIntelligence());
    const contacts = data.contacts as Array<{ groupId: string }>;
    const state = engine.getState();

    const enemyIds = activeGroups(state, 'enemy').map((group) => group.id);
    // Some enemy forces start far beyond vision; those must be absent entirely.
    expect(contacts.length).toBeLessThan(enemyIds.length);
    for (const contact of contacts) expect(enemyIds).toContain(contact.groupId);
  });

  it('rounds strength estimates rather than reporting exact rosters', () => {
    run(TICKS_PER_SECOND * 130);
    const data = unwrap(tools.getIntelligence());
    const contacts = data.contacts as Array<{ estimatedStrength: number; groupId: string }>;
    expect(contacts.length).toBeGreaterThan(0);

    for (const contact of contacts) {
      expect(contact.estimatedStrength % 25).toBe(0);
    }
  });

  it('refuses an attack order against a force never seen', async () => {
    const error = expectFailure(
      await call(
        tools.orderGroup({
          groupIds: ['legion_i'],
          order: 'attack_group',
          targetGroupId: 'siege_train',
        }),
      ),
    );
    expect(error.message.toLowerCase()).toContain('intelligence');
  });
});

describe('commands', () => {
  it('moves a group through the same queue the player uses', async () => {
    const data = unwrap(
      await call(
        tools.orderGroup({ groupIds: ['cavalry_i'], order: 'move', targetZone: 'west_crossing' }),
      ),
    );
    expect(data.ok).toBe(true);

    const group = activeGroups(engine.getState(), 'player').find((g) => g.id === 'cavalry_i');
    expect(group?.order.kind).toBe('move');
    expect(group?.path.length).toBeGreaterThan(0);
  });

  it('rejects an unknown zone name', async () => {
    expectFailure(
      await call(tools.orderGroup({ groupIds: ['legion_i'], order: 'move', targetZone: 'moon' })),
      'INVALID_INPUT',
    );
  });

  it('splits a group while preserving its mix of troops', async () => {
    const before = activeGroups(engine.getState(), 'player').find((g) => g.id === 'reserve_i');
    const beforeStrength = before?.members.length ?? 0;

    const data = unwrap(
      await call(
        tools.reorganizeArmies({
          operation: 'split',
          groupId: 'reserve_i',
          percent: 40,
          name: 'Reserve East',
        }),
      ),
    );

    const state = engine.getState();
    const detachment = activeGroups(state, 'player').find((g) => g.id === data.newGroupId);
    const source = activeGroups(state, 'player').find((g) => g.id === 'reserve_i');

    expect(detachment).toBeDefined();
    expect(source).toBeDefined();
    expect((detachment?.members.length ?? 0) + (source?.members.length ?? 0)).toBe(beforeStrength);
    expect(detachment?.members.length).toBeGreaterThan(beforeStrength * 0.3);

    // The detachment inherits archers and spearmen, not just the first category.
    const categories = new Set(
      (detachment?.members ?? []).map((index) => state.units.categoryOf(index)),
    );
    expect(categories.size).toBeGreaterThan(1);
  });

  it('refuses to command the enemy', async () => {
    expectFailure(
      await call(tools.orderGroup({ groupIds: ['iron_host'], order: 'hold' })),
      'GROUP_NOT_FOUND',
    );
  });
});
