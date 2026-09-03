# WebMCP Tools

The page publishes **two** tool surfaces, never both at once: the War Council
surface while the home screen is up, and the battlefield surface once an army
has deployed. The first lets an agent read every battlefield and *design a
battle*; the second lets it fight one.

The page registers native, page-local tools through
`document.modelContext.registerTool`. It does not embed an AI chat interface, a
tool inspector, or a backend MCP server. Every input schema is strict
(`additionalProperties: false`) and is enforced again by a runtime validator;
official type definitions come from the `webmcp-types` package.

## Browser prerequisites

- A secure context: HTTPS or localhost.
- `Origin-Agent-Cluster: ?1` on the response.
- `Permissions-Policy: tools=(self)`.
- A client implementing native WebMCP discovery. A sidebar that can only read
  the DOM does not make `document.modelContext` available.

`vite.config.ts` covers dev and preview, `public/_headers` covers static hosts,
`vercel.json` covers Vercel. Registration writes `connected`, `unavailable` or
`failed` to `document.documentElement.dataset.webmcpStatus`.

## The War Council surface

Registered while the home screen is up, and unregistered — through the same
`AbortSignal` it was registered with — the moment an army deploys. There is no
simulation behind these tools and nothing hidden from them.

| Tool | Read | Purpose |
|---|---|---|
| `list_operations` | ✓ | Every operation with its ground, both orders of battle, the regiment each king rides with, the difficulty presets, and the table's current battlefield |
| `describe_battlefield` | ✓ | One map: named zones with terrain and front, which are crossings, what divides the field, the roads, both musters |
| `review_operation` | ✓ | The designed operation on the table, in full, with the enemy timetable in firing order |
| `design_operation` | | Write an operation and put it on the table. Nothing is fought |
| `select_operation` | | Put an operation and a commander in front of the human without deploying. With `operationId: "custom"` it also chooses the table's ground: a `mapId` lays a fresh blank skirmish on that battlefield |
| `launch_operation` | | Deploy. The council closes and the battlefield tools take its place |

### `design_operation`

```json
{
  "name": "The Narrow Ford",
  "mapId": "river_vale",
  "summary": "Everything is thrown at one bridge, from both ends at once.",
  "twist": "Neither side has a reserve.",
  "playerRegiments": [
    {
      "id": "south_foot",
      "name": "South Foot",
      "zone": "central_field",
      "formation": "line",
      "stance": "aggressive",
      "troops": [{ "category": "infantry", "count": 700 }]
    },
    {
      "id": "south_crown",
      "name": "South Crown",
      "zone": "player_base",
      "formation": "square",
      "stance": "hold_ground",
      "carriesKing": true,
      "troops": [{ "category": "heavy_infantry", "count": 240 }]
    }
  ],
  "enemyRegiments": [ /* … one of them carriesKing … */ ],
  "enemyPlan": [
    {
      "atSeconds": 60,
      "groupId": "north_foot",
      "order": "attack_zone",
      "targetZone": "central_bridge"
    }
  ]
}
```

Rules the builder enforces, every one of them a refusal rather than a silent
correction:

- 3–12 regiments a side; 20–1,200 men a regiment; at most 4,200 men a side.
- Exactly one regiment a side carries its king. A side without one is refused,
  because the objective could never resolve.
- Every `zone` must be on the chosen map. Ground on the far side of the map's
  barrier is allowed — that is a deliberate operation, not a mistake.
- `enemyPlan` may only order regiments this design raises, may only use the
  scriptable orders (`move`, `attack_zone`, `defend_zone`, `hold`, `retreat`,
  `scout`), and must name ground for the ones that march. It is sorted into
  firing order on the way in.
- Regiment ids are lowercase slugs and become the group ids in play, so
  `get_armies` reports back exactly the names the design used.

Failures answer `INVALID_DESIGN` (a rule above), `INVALID_INPUT` (a field the
schema never offered) or `BATTLE_BEGUN` (the council has closed).

## Result envelope

Reads and successful commands return:

```json
{ "success": true, "data": { } }
```

A command adds the simulation's own verdict:

```json
{
  "success": true,
  "data": {
    "ok": true,
    "commandId": "cmd_42",
    "appliedAtTick": 1180,
    "summary": "Grey Riders attack West Crossing.",
    "groupIds": ["greyriders"],
    "warnings": []
  }
}
```

Failures return `{ "success": false, "error": { "code", "message", "suggestions" } }`.
Errors never confirm the existence of anything hidden by fog.

## Addressing

Regiments are addressed by stable id from `get_armies` (`vanguard`,
`greyriders`, …) — and by whatever ids a designed operation used, since those
become the group ids in play. Locations are named zones, never coordinates. The
zone enum in the battlefield schemas is *the ground this battle is fought on*
and nothing else, so River Vale offers:

`player_base · west_forest · west_crossing · village · central_field ·
central_bridge · central_hill · east_field · east_crossing · east_forest ·
northern_ridge · enemy_outer_defense · enemy_base`

Call `get_strategic_zones` for the map actually in front of you. (The War
Council schemas are the one exception: the map is itself an input there, so they
offer every zone in the game and refuse, at runtime, any name that is not on the
map a design chose.)

Individual soldiers are not addressable at all. Neither are kings: a king is
reported by `get_objective`, but there is no tool that targets one and no id
that names one. You act on him by ordering regiments to the ground he stands on.

## Read tools

All take no parameters except `get_army_details`. All are `readOnlyHint: true`.

| Tool | Returns |
|---|---|
| `get_battle_overview` | The objective and how it stands, strength, visible enemy strength, per-front status, recent alerts, reinforcements, plan status. The place to start. |
| `get_objective` | How the battle is won. Your king, his Royal Guard, any capture against him, and what is *known* of the enemy king. |
| `get_armies` | Every regiment: strength, percent remaining, formation, stance, morale, activity, zone, composition. |
| `get_army_details` | One regiment in depth: casualties, current order and its age, what its formation is good for, nearby friendlies, known threats. Takes `groupId`. |
| `get_visible_enemies` | Enemy forces in sight right now. |
| `get_intelligence` | Everything known, including stale last-known positions. Strength is estimated. |
| `get_front_status` | West, centre, east and rear: relative strength, committed regiments, zone control. |
| `get_alerts` | Recent strategic events. |
| `get_strategic_zones` | The named map: terrain, front, control, and which zones are crossings. |
| `get_active_orders` | What every regiment is doing, plus armed conditionals with their triggers. |
| `get_plan` | The plan currently drafted or executing. |

Fog rules, applied inside `GameQueries`:

- Enemy regiments never seen are absent entirely, not listed as unknown.
- `estimatedStrength` is rounded to the nearest 25.
- Contacts not currently visible carry `visibleNow: false` and
  `lastSeenSecondsAgo`; their positions are stale by design.
- Zone control over unexplored ground reads `unknown`.

## Command tools

### `order_group`

`groupIds` (1–12), `order`, and optionally `targetZone`, `targetGroupId`,
`formation`, `stance`.

`order` is one of `move`, `attack_zone`, `attack_group`, `defend_zone`, `hold`,
`retreat`, `scout`, `support`. `attack_zone` drives onto the objective; `move`
and `defend_zone` stop on its near edge so arriving regiments muster instead of
stacking. `attack_group` and `support` require `targetGroupId`.

Errors: `GROUP_NOT_FOUND` (missing, not yours, or destroyed), `INVALID_TARGET`,
`GROUP_ROUTING` (a broken regiment refuses orders until it rallies),
`INVALID_INPUT`.

An attack on an enemy regiment routes to its **last known** position from your
own contacts. Attacking a force never seen is refused.

### `reorganize_armies`

`operation` is `split`, `merge` or `rename`.

- `split` — `groupId`, `percent` (1–99), `name`. The detachment is drawn evenly
  across the roster, so it inherits the parent's mix of troop types.
- `merge` — `groupIds` (2–8); the first absorbs the rest. Optional `name`.
- `rename` — `groupId`, `name`.

### `set_conditional_order` / `cancel_conditional_order`

Arms an order that fires once, later, when a trigger is met. Takes `groupId`,
`action`, an optional target and formation or stance, a `condition`, and a
`note`. Cancel with the `conditionalId` returned, or find it in
`get_active_orders`.

`immediate` is rejected here: that is just an order.

### `focus_siege`

`siegeGroupId`, `targetZone`. Commits siege to bombard a zone, deployed loose
and holding ground. Fails with `NOT_A_SIEGE_GROUP` if the regiment has no engines.

### `direct_reinforcements`

Optional `targetZone` or `targetGroupId`. Commits a banked wave as a new
regiment. Fails with `NO_REINFORCEMENTS` and an estimate of the wait.

## The objective

The battle is won by capturing the enemy king, or by breaking his army entirely.
Each king rides with a Royal Guard regiment and is taken by holding the ground
within 420 units of him: attackers must bring at least 110 strength and outweigh
the defenders by a quarter before progress begins, and the rate is capped so no
force is large enough to carry a king off before a relief column could arrive.

`get_objective` is fog-limited in a specific way worth understanding:

- **Your own king** is fully reported — status, capture percentage, guard
  strength, and how many are for and against him. These are your men; you would
  know.
- **The enemy king** is reported only as `lastSeenZone`, `lastSeenSecondsAgo`
  and `visibleNow`. There is no live position in the projection at any point,
  and until he has been sighted once, `lastSeenZone` is absent and the note says
  so. Capture progress against him is reported only while your own men are in
  the ring, which is the one circumstance in which you would in fact know it.

So a Marshal cannot locate the enemy sovereign by asking. It has to scout.

Once the battle is decided, every command fails with `BATTLE_OVER` rather than
hanging: the simulation has stopped, and the tool result says so.

## Plan Mode

A plan is inert state. Creating or revising one moves nothing; the battlefield
draws it as numbered translucent arrows with highlighted target zones so the
commander can read the operation before committing.

### `create_plan`

`name` and `steps` (1–20). Each step takes `groupId`, `action`, an optional
target, an optional `formation`/`stance`, a `startCondition`, and a `note` shown
on the overlay.

Every step is validated up front, so a plan is never half-valid at execution.
Creating a plan supersedes any previous draft.

### `modify_plan`

`planId` and `modifications`: `add_step`, `remove_step`, `replace_step`,
`move_step`, `rename`. Draft plans only — an executing plan returns
`PLAN_NOT_EDITABLE`. Modifications are validated against a copy, so a bad edit
cannot leave a mangled plan.

### `execute_plan`

Immediate steps become orders at once; conditional steps are armed and fire when
their trigger is met. Returns how many of each.

### `cancel_plan`

Disarms pending steps. Orders already issued still stand — cancelling a plan is
not a recall of troops already marching.

## Condition vocabulary

Triggers are data drawn from a closed set, never code:

| Kind | Fields | Fires when |
|---|---|---|
| `immediate` | — | At once (plan steps only) |
| `after_step` | `stepId` | That step has fired |
| `morale_below` | `groupId`, `value` | Morale drops below the value |
| `strength_below` | `groupId`, `percent` | Strength drops below the percentage |
| `enemy_enters_zone` | `zoneId` | A visible enemy is in that zone |
| `friendly_zone_lost` | `zoneId` | You no longer control it |
| `enemy_unit_type_visible` | `category`, optional `zoneId` | That troop type is seen |
| `timer_elapsed` | `seconds` | That long after arming |
| `king_besieged` | — | Your own king comes under threat of capture |

Conditions are evaluated against the arming side's own intelligence, so a
trigger can never react to something that side cannot see. Each fires once.

