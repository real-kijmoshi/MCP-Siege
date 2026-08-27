import type { MarshalActivityStore } from '../../ui/MarshalActivity';
import { ASSIGN_WORKERS_INPUT_SCHEMA, EMPTY_INPUT_SCHEMA } from './schemas';
import type { WebMcpToolHandlers } from './tools';

export type WebMcpConnectionResult =
  | {
      status: 'connected';
      toolCount: number;
    }
  | {
      status: 'unavailable';
      code: 'API_UNAVAILABLE';
    }
  | {
      status: 'failed';
      code: 'REGISTRATION_FAILED';
      message: string;
    };

const WEBMCP_TOOL_COUNT = 3;

let registrationController: AbortController | undefined;

export async function registerWebMcpTools(
  handlers: WebMcpToolHandlers,
  activity: MarshalActivityStore,
  modelContext: WebMCP.ModelContext | undefined =
    typeof document === 'undefined' ? undefined : document.modelContext,
): Promise<WebMcpConnectionResult> {
  if (typeof modelContext?.registerTool !== 'function') {
    return { status: 'unavailable', code: 'API_UNAVAILABLE' };
  }

  registrationController?.abort();
  const controller = new AbortController();
  registrationController = controller;

  const tools: WebMCP.ModelContextTool[] = [
    {
      name: 'get_game_overview',
      title: 'Get game overview',
      description:
        'Read a concise, visibility-safe overview of the current medieval RTS battle. This tool has no side effects.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: { readOnlyHint: true },
      execute: () => handlers.getGameOverview(),
    },
    {
      name: 'get_economy',
      title: 'Get economy',
      description:
        'Read current stockpiles, gathering rates, and worker assignments for the human player. This tool has no side effects.',
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: { readOnlyHint: true },
      execute: () => handlers.getEconomy(),
    },
    {
      name: 'assign_workers',
      title: 'Assign workers',
      description:
        'Reallocate the human player’s existing economic workers. This changes live game state through the normal deterministic command queue and never creates workers.',
      inputSchema: ASSIGN_WORKERS_INPUT_SCHEMA,
      annotations: { readOnlyHint: false },
      execute: (input) => handlers.assignWorkers(input),
    },
  ];

  try {
    for (const tool of tools) {
      await modelContext.registerTool(tool, { signal: controller.signal });
    }
    activity.record('SUCCESS', `WebMCP connected · ${WEBMCP_TOOL_COUNT} Marshal tools ready.`);
    return { status: 'connected', toolCount: WEBMCP_TOOL_COUNT };
  } catch (error) {
    controller.abort();
    if (registrationController === controller) registrationController = undefined;
    const message = error instanceof Error ? error.message : 'Unknown registration error.';
    activity.record('ERROR', `WebMCP registration failed: ${message}`);
    return { status: 'failed', code: 'REGISTRATION_FAILED', message };
  }
}

export function getWebMcpCapabilityMessage(): string {
  if (!window.isSecureContext) {
    return 'WebMCP requires HTTPS or localhost. Open this page in a secure context.';
  }
  if (!window.originAgentCluster) {
    return 'WebMCP requires origin isolation. Restart the dev server and reload this tab.';
  }
  return 'Native WebMCP is not enabled in this browser. For local Chrome, enable chrome://flags/#enable-webmcp-testing, relaunch Chrome, then reload this page.';
}
