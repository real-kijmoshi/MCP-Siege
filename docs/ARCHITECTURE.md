# Architecture

## Simulation

SimulationEngine exclusively owns the mutable, serializable GameState and advances at 20 ticks per second. State contains deterministic sequences, both players, stockpiles, stable units, villagers, buildings, raw resource nodes, production queues, upgrades, and a bounded command log. Snapshots are cloned before leaving the boundary.

## Command lifecycle

1. Human controls, WebMCP, enemy AI, or debug code call engine.dispatch.
2. The engine assigns issuedAtTick and a monotonic sequence.
3. CommandQueue orders commands by tick and sequence.
4. A handler validates ownership, selection, costs, capacity, and placement before mutation.
5. Valid mutations are atomic; failures change no command-owned domain state.
6. Results are logged and emitted to UI adapters.

Commands cover movement, direct gathering, worker blueprint placement, unit training, focused research, attack targets, and secondary workforce allocation. Production reserves population across all queues.

## Systems

After commands, deterministic systems advance movement, in-range gathering, construction, production, and combat in stable entity-ID order. Randomness remains simulation-owned. Storehouse bonuses, costs, timings, unit statistics, and rosters are centralized in gameplay configuration.

## Query lifecycle

GameQueries receives a snapshot provider and returns narrow projections. Fog-of-war filtering belongs here when implemented. WebMCP never receives raw state.

## Renderer and UI

GameScene creates only undeveloped terrain and resource-node visuals statically. Each frame it reconciles units and buildings, including blueprints and progress, from stable snapshot IDs. Selection and placement modes are renderer-owned; gameplay actions dispatch typed commands. Phaser never mutates simulation state.

## WebMCP

The adapter owns schemas, feature detection, tool handlers, and result shaping. Reads call GameQueries. Worker allocation dispatches a normal command and creates physical gathering orders. The game remains fully playable without WebMCP.

## Enemy AI

The deterministic planner submits enemy_ai commands to the shared queue. It starts with the same Town Hall/five-worker footprint, gathers raw resources, pays for blueprints, respects population and queues, constructs defenses, and sends trained units to attack.

## Known boundaries

Units use direct deterministic steering. Combat owns range, cooldown, damage, towers, and deaths in simulation. Obstacle-aware navigation, formations, and fog of war remain later work.
