# Iron & Oath: WebMCP Medieval RTS

Iron & Oath is a compact browser RTS prototype for the OpenAI WebMCP Challenge. A human commander manages the same deterministic simulation through familiar controls that an AI Marshal can inspect and command through page-native WebMCP tools.

The playable vertical slice begins with one Town Hall, five villagers, raw resources, and open land. Workers physically gather and construct; Houses unlock population, production buildings own timed queues, Armouries provide focused upgrades, and a similarly constrained enemy grows and attacks.

## Run locally

```bash
npm install
npm run dev
```

Open the URL printed by Vite (normally `http://localhost:5173`).

## Validate

```bash
npm run typecheck
npm run test
npm run build
```

The production output is a static site in `dist/`.

## Controls

- Left-click or drag-select villagers and units.
- Right-click raw resources to gather, open land to move, enemies to attack, incomplete buildings to assist, or damaged friendly buildings to repair.
- With villagers selected, choose a building in the command panel and left-click open land to place its blueprint.
- Select a completed Town Hall or military building to queue units.
- Select a completed Armoury to research a focused upgrade.
- Double-click a unit to select nearby units of its type. Use Shift to add to a selection.
- Press Ctrl+1–9 to assign control groups and 1–9 to recall them; double-tap a group number to center it.
- Press A to select all villagers, H for the Town Hall, F to center, M to arm movement, G for attack-move, S to stop, or X to hold.
- Click or drag the minimap to move the camera.
- Pan the map with `WASD` or arrow keys.
- Zoom with the mouse wheel.

Every action crosses the same deterministic command queue. WebMCP exposes the same gathering, building, production, and unit-order systems using stable IDs and fog-safe queries.

## Test WebMCP manually

This project uses native in-browser WebMCP through `document.modelContext`. It does not embed a chatbot or require an MCP backend.

For local development in Chrome:

1. Open `chrome://flags/#enable-webmcp-testing`.
2. Set **WebMCP for testing** to **Enabled**, then relaunch Chrome.
3. Restart `npm run dev` after pulling configuration changes, and reload the game tab.
4. Inspect the page from a WebMCP-capable browser agent or the Model Context Tool Inspector extension.

The Vite server sends `Origin-Agent-Cluster: ?1` and `Permissions-Policy: tools=(self)`, which native WebMCP requires. Discovery and invocation happen in the browser agent; the compact Marshal activity drawer only reports short command outcomes and diagnostics and is not a chat interface.

Registered tools:

- `get_game_overview` — concise player/economy status.
- `get_economy` — stockpiles, rates, and worker jobs.
- `assign_workers` — reallocates economic workers through the command queue.
- `get_command_entities` — stable friendly IDs and visible enemy contacts.
- `construct_building` — places a validated worker-built structure.
- `train_unit` — queues a supported unit at a production building.
- `order_units` — moves, attacks, attack-moves, stops, holds, defends, or retreats with an optional formation and stance.

For nonvisual diagnostics, the page records `connected`, `unavailable`, or `failed` in `document.documentElement.dataset.webmcpStatus`. This does not add any WebMCP-facing UI to the game.

For deployed Chrome testing, WebMCP currently requires participation in its browser origin trial. Static deployment headers are included for hosts that support `_headers` files and for Vercel.

See [docs/WEBMCP.md](docs/WEBMCP.md) for the full contracts.
