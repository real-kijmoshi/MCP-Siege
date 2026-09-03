import { BATTLE_MAPS, BATTLE_MAP_IDS, type BattleMapId } from '../../game/config/maps';
import {
  CustomOperationError,
  buildCustomOperation,
  type CustomOperationSpec,
} from '../../game/config/customBattle';
import {
  AUTHORED_SCENARIO_IDS,
  DIFFICULTIES,
  DIFFICULTY_IDS,
  type DifficultyId,
  type ScenarioId,
} from '../../game/config/matches';
import type { GroupSpec, ScenarioDefinition } from '../../game/config/scenario';
import { CATEGORY_TOKEN } from '../../game/config/battle';
import type { UnitCategory } from '../../game/types/domain';
import { toolFailure, toolSuccess, type ToolResult } from './results';
import { InputError, asObject, optionalEnum, rejectUnknown, requireEnum } from './validate';

/**
 * The War Council tool surface.
 *
 * Before a battle exists there is nothing to command and nothing to hide, so
 * this surface does the one thing the in-battle surface cannot: it lets an
 * external Marshal read every battlefield in the game, write an operation of
 * its own on one of them, and then fight it.
 *
 * A designed operation is data, never code. It goes through
 * `config/customBattle.ts`, which is the only thing that turns a submission
 * into a battle, and it is fought by exactly the same engine, enemy commander
 * and tool surface as the four authored operations.
 *
 * The council closes the moment an army deploys. Every tool here refuses after
 * that with `BATTLE_BEGUN`, so a late call cannot rebuild the field under a
 * commander who is already standing on it.
 */

export interface WarCouncilPort {
  /** The authored operations, in the order the screen lists them. */
  readonly authored: readonly ScenarioDefinition[];
  /** The designed operation currently on the table. */
  getDraft: () => ScenarioDefinition;
  setDraft: (operation: ScenarioDefinition) => void;
  /** Lays a fresh blank skirmish on a chosen battlefield, replacing the table. */
  setTableMap: (mapId: BattleMapId) => void;
  /** True once a Marshal has written the operation on the table itself. */
  isMarshalDesign: () => boolean;
  getSelection: () => { operationId: ScenarioId; difficultyId: DifficultyId };
  select: (operationId: ScenarioId, difficultyId?: DifficultyId) => void;
  /** Deploys the named operation. False once the field has already been taken. */
  deploy: (operationId: ScenarioId, difficultyId?: DifficultyId) => boolean;
  hasDeployed: () => boolean;
}

export interface WarCouncilToolHandlers {
  listOperations: () => ToolResult<unknown>;
  describeBattlefield: (input: unknown) => ToolResult<unknown>;
  designOperation: (input: unknown) => ToolResult<unknown>;
  reviewOperation: () => ToolResult<unknown>;
  selectOperation: (input: unknown) => ToolResult<unknown>;
  launchOperation: (input: unknown) => ToolResult<unknown>;
}

const OPERATION_IDS = [...AUTHORED_SCENARIO_IDS, 'custom'] as const;

function describeComposition(groups: readonly GroupSpec[]): Record<string, number> {
  const totals: Partial<Record<UnitCategory, number>> = {};
  for (const group of groups) {
    for (const [category, count] of group.composition) {
      totals[category] = (totals[category] ?? 0) + count;
    }
  }
  const readable: Record<string, number> = {};
  for (const category of Object.keys(totals).sort()) {
    readable[CATEGORY_TOKEN[category as UnitCategory]] = totals[category as UnitCategory] ?? 0;
  }
  return readable;
}

function strengthOf(groups: readonly GroupSpec[]): number {
  let total = 0;
  for (const group of groups) {
    for (const [, count] of group.composition) total += count;
  }
  return total;
}

function summariseArmy(groups: readonly GroupSpec[]) {
  return {
    regiments: groups.length,
    strength: strengthOf(groups),
    byType: describeComposition(groups),
    order: groups.map((group) => ({
      id: group.id,
      name: group.name,
      strength: strengthOf([group]),
      formation: group.formation,
      stance: group.stance,
    })),
  };
}

function summariseOperation(operation: ScenarioDefinition) {
  const map = BATTLE_MAPS[operation.mapId];
  return {
    id: operation.id,
    origin: operation.origin,
    name: operation.name,
    numeral: operation.numeral,
    battlefield: { id: map.id, name: map.name, terrainNote: map.terrainNote },
    location: operation.location,
    summary: operation.summary,
    briefingLine: operation.briefingLine,
    twist: operation.twist,
    objective: operation.objective,
    pressure: operation.pressure,
    duration: operation.duration,
    tags: operation.tags,
    battleOrders: operation.battleOrders,
    armies: {
      player: { name: operation.playerArmyName, ...summariseArmy(operation.playerGroups) },
      enemy: { name: operation.enemyArmyName, ...summariseArmy(operation.enemyGroups) },
    },
    kings: operation.kingSpecs.map((king) => ({
      side: king.ownerId,
      name: king.name,
      ridesWith: king.guardGroupId,
    })),
    scriptedOrders: operation.aiScript.length,
  };
}

function describeMap(mapId: BattleMapId) {
  const map = BATTLE_MAPS[mapId];
  return {
    id: map.id,
    name: map.name,
    summary: map.summary,
    terrainNote: map.terrainNote,
    playerMuster: map.playerHomeZone,
    enemyMuster: map.enemyHomeZone,
    barrier:
      map.barrier === undefined
        ? null
        : {
            kind: map.barrier.kind,
            name: map.barrier.name,
            note:
              'Impassable except at the zones marked as crossings. A design that puts a regiment ' +
              'on the far side of it has put that regiment behind enemy lines, which may be ' +
              'exactly the operation you want.',
          },
    zones: map.zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      terrain: zone.terrain,
      front: zone.front,
      crossing: zone.crossing,
      description: zone.description,
    })),
    roads: map.roads,
  };
}

/**
 * Shapes a submitted design.
 *
 * Deliberately thin: only the outer shape is checked here, because
 * `buildCustomOperation` treats every field as hostile and reports what is
 * wrong with a suggestion attached. Two validators disagreeing about the same
 * field is worse than one that is strict.
 */
function parseDesign(raw: unknown): CustomOperationSpec {
  const input = asObject(raw);
  rejectUnknown(input, [
    'name',
    'mapId',
    'summary',
    'briefingLine',
    'twist',
    'objective',
    'playerArmyName',
    'enemyArmyName',
    'playerKingName',
    'enemyKingName',
    'playerRegiments',
    'enemyRegiments',
    'enemyPlan',
  ]);
  if (!Array.isArray(input.playerRegiments) || !Array.isArray(input.enemyRegiments)) {
    throw new InputError('"playerRegiments" and "enemyRegiments" must both be arrays.', [
      'Each side needs at least three regiments, one of which carries its king.',
    ]);
  }
  return input as unknown as CustomOperationSpec;
}

export function createWarCouncilToolHandlers(port: WarCouncilPort): WarCouncilToolHandlers {
  const closed = (): ToolResult<never> =>
    toolFailure('BATTLE_BEGUN', 'The army has already deployed; the War Council is closed.', [
      'Use the battlefield tools: get_battle_overview, get_armies, order_group.',
    ]);

  const operationById = (id: ScenarioId): ScenarioDefinition | undefined => {
    if (id === 'custom') return port.getDraft();
    return port.authored.find((operation) => operation.id === id);
  };

  const guarded = <T>(run: () => ToolResult<T>): ToolResult<T> => {
    if (port.hasDeployed()) return closed();
    try {
      return run();
    } catch (error) {
      if (error instanceof CustomOperationError) {
        return toolFailure('INVALID_DESIGN', error.message, [...error.suggestions]);
      }
      if (error instanceof InputError) {
        return toolFailure('INVALID_INPUT', error.message, [...error.suggestions]);
      }
      return toolFailure(
        'COUNCIL_FAILED',
        error instanceof Error ? error.message : 'The War Council could not answer.',
      );
    }
  };

  return {
    listOperations: () =>
      guarded(() =>
        toolSuccess({
          selected: port.getSelection(),
          table: {
            mapId: port.getDraft().mapId,
            writtenByMarshal: port.isMarshalDesign(),
            note:
              'The table is a battle on ground of your choosing. select_operation with a mapId ' +
              'lays a fresh blank skirmish on that battlefield; design_operation replaces it ' +
              'with one of your own.',
          },
          operations: [
            ...port.authored.map((operation) => summariseOperation(operation)),
            summariseOperation(port.getDraft()),
          ],
          difficulties: DIFFICULTY_IDS.map((id) => ({
            id,
            name: DIFFICULTIES[id].name,
            subtitle: DIFFICULTIES[id].subtitle,
            description: DIFFICULTIES[id].description,
          })),
          battlefields: Object.values(BATTLE_MAPS).map((map) => ({
            id: map.id,
            name: map.name,
            summary: map.summary,
            terrainNote: map.terrainNote,
            zones: map.zones.length,
          })),
        }),
      ),

    describeBattlefield: (raw) =>
      guarded(() => {
        const input = asObject(raw);
        rejectUnknown(input, ['mapId']);
        const mapId = requireEnum(input, 'mapId', Object.keys(BATTLE_MAPS) as BattleMapId[]);
        return toolSuccess(describeMap(mapId));
      }),

    designOperation: (raw) =>
      guarded(() => {
        const operation = buildCustomOperation(parseDesign(raw));
        port.setDraft(operation);
        port.select('custom');
        return toolSuccess({
          designed: summariseOperation(operation),
          note:
            'The operation is on the War Council table and selected. Nothing is fought until ' +
            'launch_operation is called, so the commander can read it first.',
        });
      }),

    reviewOperation: () =>
      guarded(() =>
        toolSuccess({
          operation: summariseOperation(port.getDraft()),
          deployments: {
            player: port.getDraft().playerGroups.map((group) => ({
              id: group.id,
              name: group.name,
              formation: group.formation,
              stance: group.stance,
              composition: group.composition.map(([category, count]) => ({ category, count })),
            })),
            enemy: port.getDraft().enemyGroups.map((group) => ({
              id: group.id,
              name: group.name,
              formation: group.formation,
              stance: group.stance,
              composition: group.composition.map(([category, count]) => ({ category, count })),
            })),
          },
          enemyPlan: port.getDraft().aiScript,
        }),
      ),

    selectOperation: (raw) =>
      guarded(() => {
        const input = asObject(raw);
        rejectUnknown(input, ['operationId', 'difficultyId', 'mapId']);
        const operationId = requireEnum(input, 'operationId', OPERATION_IDS);
        const difficultyId = optionalEnum(input, 'difficultyId', DIFFICULTY_IDS);
        const mapId = optionalEnum(input, 'mapId', BATTLE_MAP_IDS);
        if (mapId !== undefined) {
          if (operationId !== 'custom') {
            throw new InputError(
              'An authored operation is fought on its own ground; "mapId" cannot move it.',
              ['Pass "mapId" with operationId "custom" to lay the table on another battlefield.'],
            );
          }
          // Choosing ground lays a fresh blank battle on it, which discards
          // whatever was on the table — a designed operation included.
          port.setTableMap(mapId);
        }
        port.select(operationId, difficultyId);
        const operation = operationById(operationId);
        return toolSuccess({
          selected: port.getSelection(),
          operation: operation === undefined ? null : summariseOperation(operation),
          note: 'Shown at the War Council. The commander deploys it, or you call launch_operation.',
        });
      }),

    launchOperation: (raw) =>
      guarded(() => {
        const input = asObject(raw ?? {});
        rejectUnknown(input, ['operationId', 'difficultyId']);
        const operationId =
          input.operationId === undefined
            ? port.getSelection().operationId
            : requireEnum(input, 'operationId', OPERATION_IDS);
        const difficultyId = optionalEnum(input, 'difficultyId', DIFFICULTY_IDS);
        const operation = operationById(operationId);
        if (operation === undefined) {
          return toolFailure('NO_SUCH_OPERATION', `There is no operation "${operationId}".`, [
            `Operations: ${OPERATION_IDS.join(', ')}.`,
          ]);
        }
        if (!port.deploy(operationId, difficultyId)) return closed();
        return toolSuccess({
          launched: summariseOperation(operation),
          difficulty: port.getSelection().difficultyId,
          note:
            'The army is deploying. The battlefield tools are registering now; start with ' +
            'get_battle_overview.',
        });
      }),
  };
}
