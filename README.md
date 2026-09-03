# Siege — a WebMCP-first battle command game

A browser strategy game about commanding **more army than one person can drive by
hand**, built so that an external AI agent can fight alongside you through
[WebMCP](https://github.com/webmachinelearning/webmcp).

Roughly 8,000 soldiers in twenty-six regiments fight over a river crossing, a
volcanic pass, a tidal causeway or an open harvest plain, and each side has a
king to lose. You are the Commander. An agent in a WebMCP-capable browser —
ChatGPT's in-app browser, or Chrome with the WebMCP flag — is your **Marshal**.
It reads the same fog-limited intelligence you do, drafts operations you can see
drawn over the battlefield before anything moves, and issues orders through
exactly the same command queue your mouse does. Before the battle it can do one
more thing: **design a battle of its own** on any of the four battlefields, put
it on the War Council table, and either hand it to you or deploy it itself.

There is no chat panel in this page. The agent lives in the browser; the page
provides the world.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run typecheck   # strict TypeScript
npm run test        # 196 deterministic tests, no browser needed
npm run build       # static bundle, ~87 kB gzipped
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
| Ctrl + A | Select the whole army |
| Tab / Shift + Tab | Step through regiments, centring on each |
| Right click | Move there, or attack the enemy under the cursor |
| Ctrl + right click | Attack-move: take that ground and fight for it |
| Shift + right click | Queue a waypoint |
| Wheel · Z · X | Zoom |
| Right-drag / WASD / arrows / middle-drag | Pan |
| Ctrl + 1–9 / 1–9 | Assign / recall a control group |
| F · H · Space · +/- · Esc | Focus selection · your king · pause · speed · clear |
| Double-click a roster row | Centre on that regiment |
| Click an alert | Fly to the ground it names |

The three letters in front of a regiment's name are its troop type, and the
readout at bottom-left names what that type beats and what beats it. Most fights
are decided by that matchup and by regiments losing heart, not by arithmetic.

Two things about the fighting are worth knowing before your first battle.
Missile troops need a lane: guns and handgunners will not fire through your own
infantry at all, and bows and engines that loft over it hit much less hard, so a
regiment of bows parked behind the melee is a regiment doing nothing. A ridge
fixes it — a battery on high ground shoots over its own army — and so does a
flank. The roster marks a regiment that has lost its lane `MASKED`. And a charge
is delivered once: horse that has hit a line is in a melee from the next second,
and only gets its impact back by breaking clean off and coming round again. That
impact is worth arranging, because what it mostly does is break the formation it
lands on rather than kill the men in it.

The battlefield opens paused so the first briefing never costs battle time.
Issue an order, press Space, or choose a speed to begin.

Zoom out far enough and regiments collapse into density blobs with names and
morale bars, which is the view you actually want when three fronts are moving.

## What the Marshal can do

Twenty-two tools. Reads are fog-limited; every write goes through the same
`CommandQueue` as your own clicks.

**Read** — `get_battle_overview`, `get_objective`, `get_armies`,
`get_army_details`, `get_visible_enemies`, `get_intelligence`,
`get_front_status`, `get_alerts`, `get_strategic_zones`, `get_active_orders`,
`get_plan`

**Command** — `order_group`, `deploy_custom_formation`, `reorganize_armies`,
`set_conditional_order`, `cancel_conditional_order`, `focus_siege`,
`direct_reinforcements`

**Plan Mode** — `create_plan`, `modify_plan`, `execute_plan`, `cancel_plan`

Locations are named zones (`central_bridge`, `cinder_gap`, `goldmere_town`, …),
never pixels, so the Marshal reasons in the same terms you do. The zone enum is
built per battle from the map actually being fought over, so the Marshal is
never offered ground that is not in front of it.

`order_group` can append named-zone waypoints to a regiment's current route.
`deploy_custom_formation` goes further: in one atomic command the Marshal can
place different regiments in named front, wing, line, rear, and reserve slots
around a zone, with a different formation, stance, and behavior for each. The
game derives passable destinations from those semantic slots. `reorganize_armies`
can also detach a troop category — for example the archers or surgeons from a
mixed reserve — into a new regiment. Soldier pool indices remain private.

### Plan Mode

`create_plan` moves nothing. It drafts an operation, and the battlefield draws it
as numbered translucent arrows with target zones and triggers. You revise it in
conversation — "keep the cavalry further west", "hold half the reserve back" —
and `modify_plan` updates the preview. Only `execute_plan` commits it. Steps can
be gated on conditions, so a plan can arm itself and fire later.

Things to try:

> What's happening on the battlefield?
> How do I win this, and how close am I?
> Where is the Ashen King? Where am I weakest?
> Draft a plan to take the central bridge without losing the cavalry. Don't execute it.
> Move the cavalry flank further west, and keep half the reserve behind the bridge.
> Execute.
> Retreat Legion II if its morale falls below 25%.
> If my king comes under threat, pull Reserve I back to the base.
> Handle the eastern flank. I'll manage the centre.

### Fog of war is real

The Marshal cannot see through fog. `get_intelligence` returns only what you have
observed, strength figures are rounded to the nearest 25, and contacts you have
lost sight of are reported as stale last-known positions. Ordering an attack on a
force you have never seen is refused — so scouting matters, and the agent cannot
be used as an oracle.

This binds the objective too. `get_objective` never carries the enemy king's
position, only where he was last actually seen, and until he has been sighted
once he is reported as unknown.

## How you win

**Take the Ashen King.** He rides with his Royal Guard in the enemy base, and he
is taken by holding the ground around him — which means breaking or drawing off
that guard first. Capture is rate capped, so any attempt gives the defender time
to answer; while a king is beset, his whole army loses heart. An army cut below
a third of its strength concedes the field instead — regiments give way with
men still standing, and an army that has broken twice is finished.

King Aldric is behind your own lines under the same rules, and at around the
seven-minute mark the enemy sends cavalry for him. Winning the field and
forgetting what it was for is a way to lose.

The objective is drawn in the only gold on the map: a standard, a crown, and a
dashed capture ring that fills as the ground is held.

A king is not a hero unit. He has no abilities, no health bar and no slot in the
unit pool, and no tool can target him — you act on him by ordering regiments to
where he stands.

## Operations and difficulty

The War Council — the home screen — offers four authored operations, one for each
hand-built 8,000 × 5,000 battlefield, plus the designed operation on the table.
Each map is shaped around one dividing feature and the few places it can be
passed, and the portrait on the council screen is drawn from the map data
itself, so a battle designed thirty seconds ago gets a real portrait too.

**I. Bridge of Knives** — River Vale, a slow river with three crossings. Your
centre is bait. Let the Cinder Host cross, let the bridgehead crowd, then close
both wings on it. Springing it early is how you lose it.

**II. The Ember Gate** — Ashfall Pass, a dead volcanic spine broken open in two
places. Force one gap knowing the other is a road to your own camp — which is
the road their centre takes, four minutes in.

**III. The Salt Tide** — the Sunken Coast, a tidal channel crossed in exactly two
places an hour apart. Your king is stranded on the far shore with one regiment.
Fight him home, or ride for their king while their host is busy hunting yours.

**IV. The Open Hand** — Goldmere, harvest country with no feature on it at all.
Both their horse wings go wide in the first half minute, one round each end of
your line. Nothing here holds a flank but the men standing on it.

**The table** — a blank battle on whichever battlefield you pick, generated from
that map's own ground: yours to fight as it stands, and your Marshal's to
rewrite through WebMCP.

Levy, Captain, and Warlord change enemy commitment timing, reaction cadence,
threat radius, and royal relief behavior. They do not change fog-of-war rules or
give the enemy a privileged command path. The selected operation and commander
are included in `get_battle_overview`, so a WebMCP Marshal receives the same
briefing as the human player.

## Letting the Marshal design the battle

While the War Council is up — and only then — the page publishes a second, small
tool set:

| Tool | What it does |
|---|---|
| `list_operations` | Every operation, its ground, its order of battle, and the trick it turns on |
| `describe_battlefield` | One map's named zones, terrain, crossings, roads and musters |
| `design_operation` | Write a battle: a map, two armies on named ground, and the enemy's timetable |
| `review_operation` | Read the designed operation back in full |
| `select_operation` | Put an operation in front of the commander without deploying — and, for the table, choose its battlefield |
| `launch_operation` | Deploy, and hand over to the battlefield tools |

A design is data, not code. Regiments are placed by **zone name**, never by
coordinate; strength is bounded; each side must name the regiment its king rides
with; and the enemy's timetable may only order regiments that design actually
raises. Anything else comes back as a refusal with the reason and a suggestion.
The council closes the moment an army marches, and every tool above then answers
`BATTLE_BEGUN`.

```js
await design_operation({
  name: 'The Narrow Ford',
  mapId: 'river_vale',
  playerRegiments: [
    { id: 'south_foot', name: 'South Foot', zone: 'central_field',
      formation: 'line', troops: [{ category: 'infantry', count: 700 }] },
    /* … */
    { id: 'south_crown', name: 'South Crown', zone: 'player_base', carriesKing: true,
      formation: 'square', troops: [{ category: 'heavy_infantry', count: 240 }] },
  ],
  enemyRegiments: [/* … one of them carriesKing … */],
  enemyPlan: [
    { atSeconds: 60, groupId: 'north_foot', order: 'attack_zone', targetZone: 'central_bridge' },
  ],
});
```

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
