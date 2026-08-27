# Current Milestone

Classic RTS progression vertical slice — complete

# Working

- Minimal match start: each side receives one Town Hall, five idle villagers, small stockpiles, and no prebuilt settlement.
- Large undeveloped battlefield with raw food, forest, stone, and iron deposits; decorative cottages, farms, walls, quarry buildings, and mine shafts were removed.
- Direct villager orders: select villagers and right-click a resource; they walk there before gathering.
- Deterministic movement, worker-built blueprints, visible construction progress, multi-builder acceleration, and atomic placement/cost validation.
- House, Storehouse, Barracks, Archery Range, Stable, Armoury, Siege Workshop, Watch Tower, Wall, and Gate construction.
- Real population capacity: Town Hall starts at 10, Houses add 5, and production queues reserve population.
- Five-item timed production queues and physical spawn beside production buildings.
- Focused unit rosters and four prototype Armoury upgrades.
- Direct attacks, nearby auto-engagement, deterministic damage/cooldowns, deaths, and Watch Tower fire.
- Enemy AI starts with the same minimal base, gathers, builds, trains, defends, and later attacks through normal commands.
- Snapshot-driven Phaser visuals for units, blueprints, buildings, resource depletion, selection, health, and minimap ownership.
- Contextual HUD with build, production, upgrade, queue, gathering-rate, and population-cap feedback.
- WebMCP worker allocation remains a secondary convenience and now creates world gathering orders.
- Typecheck, 20 deterministic tests, and production build passing.

# Intentionally Limited

- One skirmish map and one deterministic enemy; no campaign, multiplayer, diplomacy, heroes, procedural maps, or large technology tree.
- Navigation is direct steering without advanced collision/pathfinding; walls and gates are combat defenses but do not yet alter a navigation mesh.
- Combat is a readable prototype, not the later regiment/formation system.
- Fog of war remains a future visibility layer inside GameQueries.

# Next Recommended Task

- Add deterministic obstacle-aware navigation and rally points, then tune costs and timers through playtesting.
