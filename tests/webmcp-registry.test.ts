import { describe, expect, it } from 'vitest';
import { GameQueries } from '../src/game/queries/GameQueries';
import { SimulationEngine } from '../src/game/simulation/Engine';
import { registerWebMcpTools } from '../src/integrations/webmcp/registry';
import { createWebMcpToolHandlers } from '../src/integrations/webmcp/tools';
import { MarshalActivityStore } from '../src/ui/MarshalActivity';

class FakeModelContext extends EventTarget implements WebMCP.ModelContext {
  public ontoolchange: ((this: WebMCP.ModelContext, event: Event) => unknown) | null = null;
  public readonly registrations: Array<{
    tool: WebMCP.ModelContextTool;
    signal: AbortSignal | undefined;
  }> = [];

  public constructor(private readonly failAtRegistration?: number) {
    super();
  }

  public registerTool(
    tool: WebMCP.ModelContextTool,
    options?: WebMCP.ModelContextRegisterToolOptions,
  ): Promise<void> {
    if (this.registrations.length === this.failAtRegistration) {
      return Promise.reject(new DOMException('Tool registration is blocked.', 'NotAllowedError'));
    }
    this.registrations.push({ tool, signal: options?.signal });
    return Promise.resolve();
  }

  public getTools(): Promise<WebMCP.RegisteredTool[]> {
    return Promise.resolve([]);
  }
}

function fixture() {
  const engine = new SimulationEngine();
  const queries = new GameQueries(() => engine.getSnapshot());
  const activity = new MarshalActivityStore();
  const handlers = createWebMcpToolHandlers(engine, queries, activity);
  return { activity, handlers };
}

describe('native WebMCP registration', () => {
  it('reports an unavailable API without claiming a connection', async () => {
    const { activity, handlers } = fixture();
    await expect(registerWebMcpTools(handlers, activity, undefined)).resolves.toEqual({
      status: 'unavailable',
      code: 'API_UNAVAILABLE',
    });
    expect(activity.getEntries()).toHaveLength(0);
  });

  it('registers all three tools with strict schemas and lifecycle signals', async () => {
    const { activity, handlers } = fixture();
    const modelContext = new FakeModelContext();
    const result = await registerWebMcpTools(handlers, activity, modelContext);

    expect(result).toEqual({ status: 'connected', toolCount: 3 });
    expect(modelContext.registrations.map(({ tool }) => tool.name)).toEqual([
      'get_game_overview',
      'get_economy',
      'assign_workers',
    ]);
    expect(modelContext.registrations.every(({ signal }) => signal instanceof AbortSignal)).toBe(true);
    expect(
      modelContext.registrations.every(
        ({ tool }) =>
          (tool.inputSchema as { additionalProperties?: boolean }).additionalProperties === false,
      ),
    ).toBe(true);
    expect(activity.getEntries()[0]).toMatchObject({ kind: 'SUCCESS' });
  });

  it('unregisters partial registrations when the browser rejects a tool', async () => {
    const { activity, handlers } = fixture();
    const modelContext = new FakeModelContext(1);
    const result = await registerWebMcpTools(handlers, activity, modelContext);

    expect(result).toMatchObject({
      status: 'failed',
      code: 'REGISTRATION_FAILED',
      message: 'Tool registration is blocked.',
    });
    expect(modelContext.registrations).toHaveLength(1);
    expect(modelContext.registrations[0]?.signal?.aborted).toBe(true);
    expect(activity.getEntries()[0]).toMatchObject({ kind: 'ERROR' });
  });
});
