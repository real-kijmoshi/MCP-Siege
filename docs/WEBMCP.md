# WebMCP Tools

The adapter registers native, page-local tools through `document.modelContext.registerTool`. It does not embed an AI chat interface or connect to a backend MCP server. Every input schema is strict (`additionalProperties: false`), and official definitions come from the `webmcp-types` package.

## Browser prerequisites

- The page must run in a secure context: HTTPS or localhost.
- The response must opt into origin isolation with `Origin-Agent-Cluster: ?1`.
- The `tools` permissions policy must allow the page. The project sends `Permissions-Policy: tools=(self)`.
- For local Chrome development, enable `chrome://flags/#enable-webmcp-testing`, relaunch Chrome, and reload the page.
- For deployed Chrome testing during the experimental period, enroll the deployment origin in the WebMCP origin trial.
- The agent or extension must implement native WebMCP discovery. A generic chat sidebar that can only read the DOM does not make `document.modelContext` available.

Vite development and preview headers are configured in `vite.config.ts`. `public/_headers` covers compatible static hosts, and `vercel.json` covers Vercel. Other hosts must configure the same two response headers.

The game intentionally renders no WebMCP panel, chatbot, status badge, connection widget, or tool inspector. Tool discovery and invocation belong to the browser agent. For nonvisual diagnostics, registration writes `connected`, `unavailable`, or `failed` to `document.documentElement.dataset.webmcpStatus`.

## Result envelope

Successful reads return:

```json
{ "success": true, "data": {} }
```

Successful commands return:

```json
{
  "success": true,
  "data": {
    "ok": true,
    "commandId": "cmd_1",
    "summary": "Worker orders updated: 5 food, 4 wood, 2 stone, 1 iron.",
    "affectedEntities": ["unit_villager_01"]
  }
}
```

Failures return `{ "success": false, "error": { "code", "message", "suggestions" } }`. Enemy summaries are currently limited to information visible on the open battlefield; future fog-of-war target errors must not confirm hidden entity existence.

## `get_game_overview`

- Purpose: Return a concise player status, not a state dump.
- Parameters: none; extra properties are rejected.
- Result: tick, resources, population/cap, worker and military counts, regiment count, alerts, visible threat summary, and ongoing production.
- Errors: `QUERY_FAILED` if projection fails.
- Associated query: `GameQueries.getGameOverview(playerId)`.
- Visibility: scoped to the requesting player. Future threat data is filtered inside the query.

## `get_economy`

- Purpose: Inspect stockpiles, gathering rates, worker distribution, idle workers, construction jobs, and production queues.
- Parameters: none; extra properties are rejected.
- Result: an economy projection for the player.
- Errors: `QUERY_FAILED` if projection fails.
- Associated query: `GameQueries.getEconomy(playerId)`.
- Visibility: returns only the player's economy.

## `assign_workers`

- Purpose: Set desired economic-worker counts by resource.
- Parameters: `food`, `wood`, `stone`, and `iron`; each is a required integer from 0 to 200. Extra properties are rejected.
- Result: command ID, summary, affected villager IDs, resulting assignments, idle count, and warnings.
- Errors: `INVALID_INPUT`, `PLAYER_NOT_FOUND`, or a structured command validation error.
- Associated command: `AssignWorkers` through `SimulationEngine.dispatch('webmcp', ...)`.
- Visibility: affects only the player's owned villagers. Requested totals above the workforce are capped deterministically and reported as a warning.
