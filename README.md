# Siege — a WebMCP-first battle command game

A browser strategy game about commanding **more army than one person can drive by
hand**, built so that an external AI agent can fight alongside you through
[WebMCP](https://github.com/webmachinelearning/webmcp).

Roughly 7,200 soldiers in eighteen regiments hold a river line. You are the
Commander. An agent in a WebMCP-capable browser — ChatGPT's in-app browser, or
Chrome with the WebMCP flag — is your **Marshal**. It reads the same fog-limited
intelligence you do, drafts operations you can see drawn over the battlefield
before anything moves, and issues orders through exactly the same command queue
your mouse does.

There is no chat panel in this page. The agent lives in the browser; the page
provides the world.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run typecheck   # strict TypeScript
npm run test        # 46 deterministic tests, no browser needed
npm run build       # static bundle, ~35 kB gzipped
```

Deploys as a static site. `vercel.json` and `public/_headers` carry the two
response headers WebMCP requires.

## Turning on the Marshal

WebMCP is an experimental browser API. The page needs three things:

1. **A secure context** — HTTPS or localhost.
2. **Origin isolation** — `Origin-Agent-Cluster: ?1`.
3. **The tools permission** — `Permissions-Policy: tools=(self)`.

The dev server, `vercel.json` and `public/_headers` all set 2 and 3 already.

Then use a client that implements native WebMCP discovery:

- **Chrome**: enable `chrome://flags/#enable-webmcp-testing`, relaunch, open the page.
- **ChatGPT's in-app browser**: open the deployed URL inside it.

A sidebar that can only read the DOM will not work — `document.modelContext` has
to exist. The status dot in the top bar reads `WEBMCP READY` when registration
succeeds; hover it for the reason when it does not.

The game is fully playable with no agent at all.

## Playing it by hand

| Input | Action |
|---|---|
| Left click | Select the regiment under the cursor |
| Drag | Box-select regiments |
| Shift + click | Add to or remove from the selection |
| Right click | Move there, or attack the enemy under the cursor |
| Shift + right click | Queue a waypoint |
| Wheel | Zoom at the cursor |
| WASD / arrows / middle-drag | Pan |
| Ctrl + 1–9 / 1–9 | Assign / recall a control group |
| F · Space · +/- · Esc | Focus selection · pause · speed · clear |

Zoom out far enough and regiments collapse into density blobs with names and
morale bars, which is the view you actually want when three fronts are moving.

## What the Marshal can do

Nineteen tools. Reads are fog-limited; every write goes through the same
`CommandQueue` as your own clicks.

**Read** — `get_battle_overview`, `get_armies`, `get_army_details`,
`get_visible_enemies`, `get_intelligence`, `get_front_status`, `get_alerts`,
`get_strategic_zones`, `get_active_orders`, `get_plan`

**Command** — `order_group`, `reorganize_armies`, `set_conditional_order`,
`cancel_conditional_order`, `focus_siege`, `direct_reinforcements`

**Plan Mode** — `create_plan`, `modify_plan`, `execute_plan`, `cancel_plan`

Locations are named zones (`central_bridge`, `west_crossing`, `east_field`, …),
never pixels, so the Marshal reasons in the same terms you do.

### Plan Mode

`create_plan` moves nothing. It drafts an operation, and the battlefield draws it
as numbered translucent arrows with target zones and triggers. You revise it in
conversation — "keep the cavalry further west", "hold half the reserve back" —
and `modify_plan` updates the preview. Only `execute_plan` commits it. Steps can
be gated on conditions, so a plan can arm itself and fire later.

Things to try:

> What's happening on the battlefield?
> Where am I weakest?
> Draft a plan to take the central bridge without losing the cavalry. Don't execute it.
> Move the cavalry flank further west, and keep half the reserve behind the bridge.
> Execute.
> Retreat Legion II if its morale falls below 25%.
> Handle the eastern flank. I'll manage the centre.

### Fog of war is real

The Marshal cannot see through fog. `get_intelligence` returns only what you have
observed, strength figures are rounded to the nearest 25, and contacts you have
lost sight of are reported as stale last-known positions. Ordering an attack on a
force you have never seen is refused — so scouting matters, and the agent cannot
be used as an oracle.

## The scenario

A river with three crossings splits an 8,000 × 5,000 battlefield. You hold the
south with nine regiments; the Ashen Host holds the north with nine of its own.

The opening is quiet enough to command by hand. Then the enemy centre storms the
bridge, cavalry sweeps the east, more cavalry threatens the western ford, and the
siege train comes into range — several fronts at once, which is the point. That
is when handing a front to the Marshal stops being a demo and starts being how
you keep up.

## How it fits together

```
Human input ──┐
WebMCP tools ─┼─> GameCommand ─> CommandQueue ─> handlers ─> GameState ─> systems
Enemy AI ─────┘                                                 │
                                        ┌───────────────────────┴──────────────┐
                                   read-only view                        GameQueries
                                   (Canvas renderer)                  (fog-safe projections)
                                                                             │
                                                                       WebMCP reads
```

One authoritative `GameState`, a deterministic 20 Hz tick, and a single command
path. Soldiers live in struct-of-arrays typed buffers and have no identity
outside the simulation; **regiments are the only thing addressable over WebMCP**,
which is what keeps a projection small enough for an agent to reason about.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/WEBMCP.md](docs/WEBMCP.md), [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) and
[docs/DECISIONS.md](docs/DECISIONS.md).

## Testing tools without an agent

Open with `?mcpdebug=1` and the handler map is on `window.__battle.tools`:

```js
await window.__battle.tools.getBattleOverview();
await window.__battle.tools.createPlan({ name: 'Test', steps: [/* … */] });
```

It is a console handle, not a UI.
