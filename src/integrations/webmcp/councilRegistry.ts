import { EMPTY_INPUT_SCHEMA } from './schemas';
import {
  DESCRIBE_BATTLEFIELD_SCHEMA,
  DESIGN_OPERATION_SCHEMA,
  LAUNCH_OPERATION_SCHEMA,
  SELECT_OPERATION_SCHEMA,
} from './councilSchemas';
import type { WarCouncilToolHandlers } from './council';

/**
 * War Council registration.
 *
 * The page publishes a second, smaller tool set while the home screen is up,
 * and takes it down the moment an army deploys — the registration is held by
 * an `AbortController`, so closing the council removes the tools rather than
 * leaving a Marshal holding orders that can no longer be obeyed.
 *
 * As on the battlefield, there is no chat, no inspector and no panel in the
 * page: the home screen is fully usable by a human with no agent present.
 */

export type WarCouncilConnection =
  | { status: 'connected'; toolCount: number; close: () => void }
  | { status: 'unavailable'; code: 'API_UNAVAILABLE'; close: () => void }
  | { status: 'failed'; code: 'REGISTRATION_FAILED'; message: string; close: () => void };

const NO_OP = (): void => {};

export async function registerWarCouncilTools(
  handlers: WarCouncilToolHandlers,
  modelContext: WebMCP.ModelContext | undefined = typeof document === 'undefined'
    ? undefined
    : document.modelContext,
): Promise<WarCouncilConnection> {
  if (typeof modelContext?.registerTool !== 'function') {
    return { status: 'unavailable', code: 'API_UNAVAILABLE', close: NO_OP };
  }

  const controller = new AbortController();
  const close = (): void => controller.abort();

  const tools: WebMCP.ModelContextTool[] = [
    {
      name: 'list_operations',
      title: 'List operations',
      description:
        'Every operation the War Council can send an army to: the four authored ones and the ' +
        'designed operation currently on the table, each with its ground, its order of battle, ' +
        'the trick it turns on, and which regiment carries each king. Also lists the ' +
        'battlefields and the three enemy commanders. Start here. Read-only.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: { readOnlyHint: true },
      execute: () => handlers.listOperations(),
    },
    {
      name: 'describe_battlefield',
      title: 'Describe a battlefield',
      description:
        'The ground of one battlefield: every named zone with its terrain and front, which ' +
        'zones are crossings, what divides the field, the roads, and where each side musters. ' +
        'This is what you need before designing an operation on it. Read-only.',
      inputSchema: DESCRIBE_BATTLEFIELD_SCHEMA,
      annotations: { readOnlyHint: true },
      execute: (input) => handlers.describeBattlefield(input),
    },
    {
      name: 'design_operation',
      title: 'Design an operation',
      description:
        'Write a battle of your own: pick a battlefield, place both armies on named ground, ' +
        'say which regiment each king rides with, and give the enemy commander a timetable. ' +
        'The design is validated, drawn on the War Council table and selected — but nothing is ' +
        'fought until launch_operation. Designing again replaces the operation on the table.',
      inputSchema: DESIGN_OPERATION_SCHEMA,
      annotations: { readOnlyHint: false },
      execute: (input) => handlers.designOperation(input),
    },
    {
      name: 'review_operation',
      title: 'Review the designed operation',
      description:
        'Read back the operation on the table in full: both orders of battle, every regiment’s ' +
        'composition, and the enemy commander’s timetable as it will actually fire. Read-only.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: { readOnlyHint: true },
      execute: () => handlers.reviewOperation(),
    },
    {
      name: 'select_operation',
      title: 'Select an operation',
      description:
        'Put an operation and an enemy commander in front of the human commander without ' +
        'deploying. Use this to propose a battle and let them press the deploy seal themselves. ' +
        'With operationId "custom" it also chooses the table\'s battlefield: passing a mapId ' +
        'lays a fresh blank skirmish on that ground for you to fight or rewrite.',
      inputSchema: SELECT_OPERATION_SCHEMA,
      annotations: { readOnlyHint: false },
      execute: (input) => handlers.selectOperation(input),
    },
    {
      name: 'launch_operation',
      title: 'Launch the operation',
      description:
        'Deploy the army and begin the battle. Defaults to whatever is currently selected. The ' +
        'War Council then closes and the battlefield tools take its place, beginning with ' +
        'get_battle_overview.',
      inputSchema: LAUNCH_OPERATION_SCHEMA,
      annotations: { readOnlyHint: false },
      execute: (input) => handlers.launchOperation(input),
    },
  ];

  try {
    for (const tool of tools) {
      await modelContext.registerTool(tool, { signal: controller.signal });
    }
    return { status: 'connected', toolCount: tools.length, close };
  } catch (error) {
    controller.abort();
    return {
      status: 'failed',
      code: 'REGISTRATION_FAILED',
      message: error instanceof Error ? error.message : 'Unknown registration error.',
      close: NO_OP,
    };
  }
}
