import { describe, expect, it } from 'vitest';
import { GameQueries } from '../src/game/queries/GameQueries';
import { SimulationEngine } from '../src/game/simulation/Engine';
import { createWebMcpToolHandlers, validateAssignWorkersInput } from '../src/integrations/webmcp/tools';
import { MarshalActivityStore } from '../src/ui/MarshalActivity';

function createFixture() {
  const engine = new SimulationEngine();
  const queries = new GameQueries(() => engine.getSnapshot());
  const activity = new MarshalActivityStore();
  const handlers = createWebMcpToolHandlers(engine, queries, activity);
  return { engine, activity, handlers };
}

describe('WebMCP boundary', () => {
  it('rejects missing and additional properties', () => {
    expect(validateAssignWorkersInput({ food: 2, wood: 2, stone: 2 })).toMatchObject({ ok: false });
    expect(
      validateAssignWorkersInput({ food: 2, wood: 2, stone: 2, iron: 2, unitId: 'hidden' }),
    ).toMatchObject({ ok: false });
  });

  it('routes worker actions through the command queue', async () => {
    const { engine, handlers } = createFixture();
    const pending = handlers.assignWorkers({ food: 2, wood: 2, stone: 0, iron: 1 });

    expect(engine.pendingCommandCount).toBe(1);
    expect(engine.getSnapshot().commandLog).toHaveLength(0);
    engine.step();
    const result = await pending;

    expect(result).toMatchObject({
      success: true,
      data: {
        ok: true,
        data: { assignments: { food: 2, wood: 2, stone: 0, iron: 1 }, idleWorkers: 0 },
      },
    });
    expect(engine.getSnapshot().commandLog[0]?.command.source).toBe('webmcp');
  });

  it('returns structured read results and records visible activity', () => {
    const { activity, handlers } = createFixture();
    const result = handlers.getGameOverview();

    expect(result).toMatchObject({
      success: true,
      data: { workerCount: 5, militaryCount: 0, visibleThreatSummary: 'No enemy forces currently visible.' },
    });
    expect(activity.getEntries()[0]).toMatchObject({ kind: 'QUERY' });
  });

  it('does not confirm or command guessed targets hidden by fog of war', async () => {
    const { engine, handlers } = createFixture();
    const result = await handlers.orderUnits({
      unitIds: ['unit_player_villager_01'], order: 'attack', targetId: 'building_enemy_town_hall',
    });
    expect(result).toMatchObject({ success: false, error: { code: 'TARGET_NOT_VISIBLE' } });
    expect(engine.pendingCommandCount).toBe(0);
  });
});
