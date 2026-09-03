import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TABLE_MAP,
  createSkirmishOperation,
  type CustomOperationSpec,
} from '../src/game/config/customBattle';
import { BATTLE_MAPS, type BattleMapId } from '../src/game/config/maps';
import { AUTHORED_SCENARIOS } from '../src/game/config/scenario';
import { createWarCouncilToolHandlers, type WarCouncilPort } from '../src/integrations/webmcp/council';
import { registerWarCouncilTools } from '../src/integrations/webmcp/councilRegistry';
import type { DifficultyId, ScenarioId } from '../src/game/config/matches';
import type { ScenarioDefinition } from '../src/game/config/scenario';
import { SimulationEngine } from '../src/game/simulation/Engine';

/**
 * The War Council tools.
 *
 * This is the surface that lets an external Marshal write its own battle, so
 * the things worth proving are that it cannot write a broken one, that what it
 * writes is what actually gets fought, and that it stops existing the moment
 * the army marches.
 */

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

interface Council {
  handlers: ReturnType<typeof createWarCouncilToolHandlers>;
  deployments: Array<{ operation: ScenarioDefinition; difficultyId: DifficultyId }>;
  draft: () => ScenarioDefinition;
}

/** A stand-in War Council: the same port the home screen implements. */
function openCouncil(): Council {
  let draft = createSkirmishOperation(DEFAULT_TABLE_MAP);
  let marshalDesign = false;
  let selectedId: ScenarioId = 'bridge_of_knives';
  let difficultyId: DifficultyId = 'captain';
  let deployed = false;
  const deployments: Council['deployments'] = [];

  const find = (id: ScenarioId): ScenarioDefinition | undefined =>
    id === 'custom' ? draft : AUTHORED_SCENARIOS.find((operation) => operation.id === id);

  const port: WarCouncilPort = {
    authored: AUTHORED_SCENARIOS,
    getDraft: () => draft,
    setDraft: (operation) => {
      draft = operation;
      marshalDesign = true;
    },
    setTableMap: (mapId) => {
      draft = createSkirmishOperation(mapId);
      marshalDesign = false;
    },
    isMarshalDesign: () => marshalDesign,
    getSelection: () => ({ operationId: selectedId, difficultyId }),
    select: (operationId, nextDifficulty) => {
      selectedId = operationId;
      if (nextDifficulty !== undefined) difficultyId = nextDifficulty;
    },
    deploy: (operationId, nextDifficulty) => {
      if (deployed) return false;
      selectedId = operationId;
      if (nextDifficulty !== undefined) difficultyId = nextDifficulty;
      const operation = find(operationId);
      if (operation === undefined) return false;
      deployed = true;
      deployments.push({ operation, difficultyId });
      return true;
    },
    hasDeployed: () => deployed,
  };

  return { handlers: createWarCouncilToolHandlers(port), deployments, draft: () => draft };
}

const MINIMAL_DESIGN: CustomOperationSpec = {
  name: 'The Narrow Ford',
  mapId: 'river_vale',
  summary: 'Everything is thrown at one bridge, from both ends at once.',
  twist: 'Neither side has a reserve, and neither side has anywhere else to be.',
  playerRegiments: [
    {
      id: 'south_foot',
      name: 'South Foot',
      zone: 'central_field',
      formation: 'line',
      stance: 'aggressive',
      troops: [{ category: 'infantry', count: 700 }],
    },
    {
      id: 'south_bows',
      name: 'South Bows',
      zone: 'central_hill',
      formation: 'loose',
      troops: [{ category: 'archer', count: 300 }],
    },
    {
      id: 'south_crown',
      name: 'South Crown',
      zone: 'player_base',
      formation: 'square',
      stance: 'hold_ground',
      carriesKing: true,
      troops: [{ category: 'heavy_infantry', count: 240 }],
    },
  ],
  enemyRegiments: [
    {
      id: 'north_foot',
      name: 'North Foot',
      zone: 'enemy_outer_defense',
      formation: 'line',
      stance: 'aggressive',
      troops: [{ category: 'infantry', count: 700 }],
    },
    {
      id: 'north_spears',
      name: 'North Spears',
      zone: 'northern_ridge',
      formation: 'double_line',
      troops: [{ category: 'spearman', count: 300 }],
    },
    {
      id: 'north_crown',
      name: 'North Crown',
      zone: 'enemy_base',
      formation: 'square',
      stance: 'hold_ground',
      carriesKing: true,
      troops: [{ category: 'heavy_infantry', count: 240 }],
    },
  ],
  enemyPlan: [
    { atSeconds: 60, groupId: 'north_foot', order: 'attack_zone', targetZone: 'central_bridge' },
    { atSeconds: 20, groupId: 'north_spears', order: 'move', targetZone: 'central_bridge' },
  ],
};

describe('registration', () => {
  it('publishes the council tools and takes them down again', async () => {
    const registered: string[] = [];
    let aborted = false;
    const council = openCouncil();

    const connection = await registerWarCouncilTools(council.handlers, {
      registerTool: async (tool: { name: string }, options?: { signal?: AbortSignal }) => {
        registered.push(tool.name);
        options?.signal?.addEventListener('abort', () => {
          aborted = true;
        });
      },
    } as never);

    expect(connection.status).toBe('connected');
    expect(registered).toEqual([
      'list_operations',
      'describe_battlefield',
      'design_operation',
      'review_operation',
      'select_operation',
      'launch_operation',
    ]);

    connection.close();
    expect(aborted).toBe(true);
  });

  it('reports unavailability rather than throwing when the API is absent', async () => {
    const connection = await registerWarCouncilTools(openCouncil().handlers, undefined);
    expect(connection.status).toBe('unavailable');
  });
});

describe('reading the council table', () => {
  it('lists every operation, including the one on the table', () => {
    const data = unwrap(openCouncil().handlers.listOperations());
    const operations = data.operations as Array<{ id: string; origin: string }>;

    expect(operations.map((operation) => operation.id)).toEqual([
      'bridge_of_knives',
      'ember_gate',
      'salt_tide',
      'open_hand',
      'old_vale',
      'custom',
    ]);
    expect(operations[5]?.origin).toBe('designed');
    expect((data.difficulties as unknown[]).length).toBe(3);
    expect((data.battlefields as unknown[]).length).toBe(4);
    expect(data.table).toEqual(
      expect.objectContaining({ mapId: DEFAULT_TABLE_MAP, writtenByMarshal: false }),
    );
  });

  it('describes the ground a design has to be written on', () => {
    const data = unwrap(openCouncil().handlers.describeBattlefield({ mapId: 'ashfall_pass' }));
    const zones = data.zones as Array<{ id: string; crossing: boolean }>;

    expect(data.id).toBe('ashfall_pass');
    expect(zones.some((zone) => zone.id === 'cinder_gap' && zone.crossing)).toBe(true);
    expect(data.barrier).not.toBeNull();
  });

  it('refuses a battlefield that does not exist', () => {
    expectFailure(
      openCouncil().handlers.describeBattlefield({ mapId: 'the_moon' }),
      'INVALID_INPUT',
    );
  });
});

describe('designing an operation', () => {
  it('accepts a design, selects it, and fights exactly what was written', () => {
    const council = openCouncil();
    const designed = unwrap(council.handlers.designOperation(MINIMAL_DESIGN));
    const operation = designed.designed as Record<string, unknown>;

    expect(operation.name).toBe('The Narrow Ford');
    expect((operation.battlefield as { id: string }).id).toBe('river_vale');

    unwrap(council.handlers.launchOperation({}));
    const deployed = council.deployments[0];
    expect(deployed).toBeDefined();
    expect(deployed?.operation.name).toBe('The Narrow Ford');

    const engine = new SimulationEngine({
      scenarioId: 'custom',
      scenario: deployed?.operation ?? createSkirmishOperation(),
      seed: 9,
    });
    const state = engine.getState();
    expect(state.groups.map((group) => group.id).sort()).toEqual([
      'north_crown',
      'north_foot',
      'north_spears',
      'south_bows',
      'south_crown',
      'south_foot',
    ]);
    expect(state.objective.kings.enemy.guardGroupId).toBe('north_crown');
  });

  it('reads a design back with its timetable in the order it will fire', () => {
    const council = openCouncil();
    unwrap(council.handlers.designOperation(MINIMAL_DESIGN));
    const review = unwrap(council.handlers.reviewOperation());
    const plan = review.enemyPlan as Array<{ atSeconds: number }>;

    expect(plan.map((entry) => entry.atSeconds)).toEqual([20, 60]);
  });

  it('rejects a broken design with a reason and leaves the table untouched', () => {
    const council = openCouncil();
    const before = council.draft().name;
    const error = expectFailure(
      council.handlers.designOperation({
        ...MINIMAL_DESIGN,
        playerRegiments: MINIMAL_DESIGN.playerRegiments.map((regiment) => ({
          ...regiment,
          carriesKing: false,
        })),
      }),
      'INVALID_DESIGN',
    );

    expect(error.message).toMatch(/carries a king/);
    expect(council.draft().name).toBe(before);
  });

  it('rejects a parameter the schema never offered', () => {
    expectFailure(
      openCouncil().handlers.designOperation({ ...MINIMAL_DESIGN, cheatMode: true }),
      'INVALID_INPUT',
    );
  });
});

describe('closing the council', () => {
  it('launches what is selected and then refuses every further call', () => {
    const council = openCouncil();
    unwrap(council.handlers.selectOperation({ operationId: 'salt_tide', difficultyId: 'warlord' }));
    unwrap(council.handlers.launchOperation({}));

    expect(council.deployments[0]?.operation.id).toBe('salt_tide');
    expect(council.deployments[0]?.difficultyId).toBe('warlord');

    expectFailure(council.handlers.listOperations(), 'BATTLE_BEGUN');
    expectFailure(council.handlers.designOperation(MINIMAL_DESIGN), 'BATTLE_BEGUN');
    expectFailure(council.handlers.launchOperation({ operationId: 'ember_gate' }), 'BATTLE_BEGUN');
    expect(council.deployments.length).toBe(1);
  });

  it('launches the operation on the table when the design is the plan', () => {
    const council = openCouncil();
    unwrap(council.handlers.launchOperation({ operationId: 'custom' }));

    expect(council.deployments[0]?.operation.name).toBe('Free Field');
  });
});

describe('choosing the table’s ground', () => {
  it('lays a fresh blank battle on any battlefield asked for', () => {
    const council = openCouncil();

    for (const mapId of Object.keys(BATTLE_MAPS) as BattleMapId[]) {
      const data = unwrap(
        council.handlers.selectOperation({ operationId: 'custom', mapId }),
      );
      const operation = data.operation as { battlefield: { id: string }; origin: string };

      expect(operation.battlefield.id).toBe(mapId);
      expect(operation.origin).toBe('designed');
      expect(council.draft().mapId).toBe(mapId);
      // Every generated table has to be a legal battle, or it could not be sent.
      expect(council.draft().kingSpecs).toHaveLength(2);
    }
  });

  it('replaces a Marshal’s own design when the ground is changed under it', () => {
    const council = openCouncil();
    unwrap(council.handlers.designOperation(MINIMAL_DESIGN));
    expect(council.draft().name).toBe('The Narrow Ford');

    unwrap(council.handlers.selectOperation({ operationId: 'custom', mapId: 'goldmere' }));
    expect(council.draft().name).toBe('Free Field');
    expect(council.draft().mapId).toBe('goldmere');
  });

  it('refuses to move an authored operation onto other ground', () => {
    const error = expectFailure(
      openCouncil().handlers.selectOperation({ operationId: 'salt_tide', mapId: 'goldmere' }),
      'INVALID_INPUT',
    );
    expect(error.message).toMatch(/its own ground/);
  });
});

