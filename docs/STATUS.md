# Current Milestone

RTS expansion and desktop-control polish pass — complete

# Working

- Minimal match start: each side receives one Town Hall, five idle villagers, small stockpiles, and no prebuilt settlement.
- A 3200 × 2000 hand-painted battlefield spans several normal camera viewports and places the player southwest and enemy northeast.
- Intentional geography includes grass and dirt variation, connected paths, clearings, a central river bridge, a secondary ford, rocky ridges, open army ground, hills, forest edges, and chokepoints.
- Painted top-down sprites replace normal-play primitives for the Town Hall, every constructible building, villagers, trees, berry food, stone, and iron. Geometry remains only as an asset-load fallback and for selection/progress feedback.
- Raw resources are many independently harvestable world objects: dense forest patches, berry clusters, multi-rock stone deposits, and distinct dark iron outcrops.
- Three-state fog of war is deterministic: unexplored terrain is hidden, explored terrain is darkened, and current vision is fully rendered.
- Enemy units and buildings are filtered inside `GameQueries`; Phaser, the minimap, and WebMCP overview tools all receive the same visibility-safe projections.
- Resource and building labels are hover-only rather than required to identify the world.
- Direct villager orders: select villagers and right-click a resource; they walk there before gathering.
- Deterministic movement, worker-built blueprints, visible construction progress, multi-builder acceleration, and atomic placement/cost validation.
- House, Storehouse, Barracks, Archery Range, Stable, Armoury, Siege Workshop, Watch Tower, Wall, and Gate construction.
- Real population capacity: Town Hall starts at 10, Houses add 5, and production queues reserve population.
- Five-item timed production queues and physical spawn beside production buildings.
- Production buildings expose unit costs, time, population, live queue progress, per-order cancellation with partial refunds, Shift-queueing, and visible rally points followed by new units.
- Eight distinct roles are complete: Villager, Swordsman, Spearman, Archer, Knight, Scout, Catapult, and Battering Ram. Military silhouettes and equipment remain readable when many units share the field.
- Focused unit rosters and four prototype Armoury upgrades.
- Direct attacks, nearby auto-engagement, deterministic damage/cooldowns, deaths, and Watch Tower fire.
- Contextual right-click covers movement, gathering, attacking, construction assistance, and damaged-building repair.
- Military commands cover Move, Attack Move, Stop, Hold Position, Defend Area, and Retreat. Line, Column, Square, Wedge, and Loose formations combine with Aggressive, Defensive, and Hold Ground stances.
- Desktop selection supports click, Shift-add, drag-box, nearby same-type double-click, Ctrl+1–9 assignment, 1–9 recall, double-tap centering, and clickable mixed-group type counts.
- Three capturable landmarks provide actual simulation benefits: remote vision/ranged defense, food/wood income at the bridge, and stone/iron income at the ruined fort.
- Enemy AI starts with the same minimal base, gathers real deposits, expands population, and sequentially constructs Houses, Barracks, Archery Range, Stable, Armoury, Siege Workshop, and Watch Tower before producing mixed patrol and assault compositions through normal commands.
- Snapshot-driven Phaser visuals for units, blueprints, buildings, resource depletion, selection, health, fog state, and minimap ownership.
- Contextual HUD with build, production, upgrade, queue, gathering-rate, and explicit population-cap feedback; the existing footprint and three-part structure are preserved.
- Placement uses the authoritative placement query for a cursor-following green/red ghost, validator reason, Escape/right-click cancellation, immediate site selection, and live construction progress.
- The minimap shows fog-filtered units, player and explored enemy buildings, neutral sites, and the camera viewport; click and drag both move the camera.
- Seven strict WebMCP tools provide fog-safe overview/economy/entity reads plus worker assignment, construction, production, and unit orders through the deterministic command queue. Marshal activity remains compact and visible in-world.
- Typecheck and 26 deterministic tests passing; live browser QA verified placement validity, construction selection/progress, stable command clicks, control-group recall, HUD density, and a clean browser console.

# Intentionally Limited

- One skirmish map and one deterministic enemy; no campaign, multiplayer, diplomacy, heroes, procedural maps, or large technology tree.
- Navigation is direct steering without advanced collision/pathfinding; walls and gates are combat defenses but do not yet alter a navigation mesh.
- Combat and formation behavior are intentionally focused rather than a large technology/counter tree; formations set deterministic destinations and stances govern engagement behavior.
- Terrain is strategically composed but does not yet enforce obstacle-aware navigation; the river, bridge, ridge, and ford become movement constraints in the planned navigation workstream.

# Next Recommended Task

- Add deterministic obstacle-aware navigation that makes the existing bridge, ford, ridge, forest edges, walls, and gates tactically binding; then tune costs, timers, counters, and enemy timing through longer playtests.
