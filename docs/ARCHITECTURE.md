# Architecture

## Simulation

`SimulationEngine` exclusively owns the mutable `GameState` and advances at 20
ticks per second. State holds the seeded PRNG, the unit pool, regiments, both
players, fog grids, enemy contacts, zone control, plans, armed conditionals and
a bounded alert list.

Soldiers live in `UnitPool`, a struct-of-arrays of typed buffers with a free
list. A unit is a slot index: it has no string id, no object, and no identity
outside the simulation. Regiments (`ArmyGroup`) are the addressable unit of
command for both the player and the Marshal, which is what keeps every external
projection small.

## Command lifecycle

1. Human input, WebMCP, the enemy AI, or a fired conditional calls `engine.dispatch`.
2. The engine stamps `issuedAtTick` and a monotonic sequence.
3. `CommandQueue` orders commands by tick, then sequence.
4. A handler validates ownership, group existence, morale state and targets
   before mutating anything.
5. Valid mutations are atomic; a failure changes no state and returns a
   structured reason.
6. Results are emitted to listeners, which is how tool calls and the UI learn
   the outcome.

`applyOrderToGroup` is the one place an order is actually applied, so a mouse
click, a WebMCP call, a plan step and the enemy AI cannot diverge in meaning.

## Systems

Each tick, in fixed order: conditionals are evaluated and dispatched, the enemy
AI submits commands, the queue drains, then movement, combat, morale,
visibility, zone control, reinforcements and alerts advance. Every system
iterates in index or sorted order, and randomness is simulation-owned.

- **Movement** walks each regiment's anchor along waypoints at the pace of its
  slowest member, assigns formation slots, and steers soldiers into them. A
  soldier who has found an enemy stands and fights within reach, or closes the
  gap if the target is inside his stance's leash.
- **Combat** rebuilds a per-faction spatial hash each tick and staggers target
  acquisition across eight ticks. Damage folds the counter matrix, both
  formations, both stances, terrain and the attacker's morale.
- **Morale** works on regiments rather than soldiers. It is the system that
  decides most engagements: lines bend and break well before they are wiped out.
- **Visibility** recomputes a three-state fog grid and updates each side's
  contact memory with rounded strength estimates.

## Query lifecycle

`GameQueries` receives a state provider and returns narrow projections. It is
the fog-of-war choke point: control of unexplored ground reads as `unknown`,
enemy figures come from contacts rather than the truth, and nothing returns raw
state.

## Renderer

`Renderer` reads live state directly and never writes. Layers draw ground, fog,
armies, effects and the plan overlay, then a screen-space pass adds the plan
legend and the selection marquee.

Units are bucketed by faction and category into preallocated buffers and drawn
with one fill per batch — fourteen fills for eight thousand men. Level of detail
switches from glyphs to blocks to per-regiment density blobs as the camera pulls
back, which is what keeps a huge battle readable.

## WebMCP

The adapter owns schemas, runtime validation, registration and result shaping.
Reads call `GameQueries`. Writes dispatch ordinary commands and await the result
the fixed-step simulation produces; they cannot mutate state or advance the
clock. The page has no Marshal interface of its own.

## Enemy AI

A deterministic escalation script plus a light reactive layer, both submitting
ordinary commands through the shared queue. The enemy plays by the same rules
and is bound by its own fog.

## Known boundaries

- Navigation is group-level over a thirteen-node zone graph. Soldiers steer
  toward slots and do not path individually or avoid each other.
- The river is the only hard obstacle; forests and hills modify combat and
  morale but do not block movement.
- Reinforcements are a manpower counter and timed waves, not an economy.
