# Architectural Decisions

## ADR-001: Commands execute on simulation ticks

Accepted commands get a deterministic sequence immediately, but handlers run
only while the engine advances a fixed tick. Input source and browser frame
timing therefore cannot affect simulation behaviour. WebMCP awaits the result
produced by the normal runner rather than mutating state or stepping the clock
itself, and times out instead of hanging if the game is paused.

## ADR-002: Regiments are the only addressable entity

Individual soldiers have no string id and never cross the query or command
boundary. This is a deliberate limit on the tool surface: it keeps every
projection small enough for an agent to reason about, makes "send 400 men east"
expressible in one call, and removes any way to address the battle at a
granularity no commander would use.

## ADR-003: The renderer reads live state; only WebMCP gets copies

Cloning thousands of units sixty times a second is not affordable, so the
renderer holds direct references to the simulation's typed arrays and is
contractually read-only. WebMCP is the boundary that genuinely matters for
isolation, and it receives purpose-built projections that never alias state.
This supersedes the snapshot-cloning approach used by the earlier prototype in
this repository.

## ADR-004: Custom Canvas 2D rather than a game framework

The visual target is squares, triangles, circles and arrows at very high unit
counts. A framework's per-entity sprite model is the wrong shape for that, so
the renderer batches geometry by hand into a few fills per frame. The whole
bundle is about 35 kB gzipped and the renderer controls its own level of detail.

## ADR-005: Strict JSON Schema plus a runtime validator

Schemas describe the tool surface to the agent; an explicit validator enforces
it at execution. A schema is documentation to the caller, not a guarantee to the
callee, so both exist and unknown properties are rejected in each.

## ADR-006: Native WebMCP is the only integration, and the page has no agent UI

Tools are published through `document.modelContext`. There is no embedded chat,
no tool inspector, no backend, and no Marshal panel: discovery and conversation
belong to the host browser. The page's only acknowledgement of WebMCP is a
status dot and a transient toast when an external order lands, so a recorded
demo reads clearly. The game is fully playable when the API is absent.

## ADR-007: Conditions are a closed vocabulary, never code

Conditional orders and gated plan steps draw their triggers from eight fixed
shapes. An external agent composes data, never executable logic, which is what
makes it safe to let it arm standing orders that fire while nobody is watching.

## ADR-008: Plans are inert until executed

`create_plan` and `modify_plan` mutate no unit. A plan is state the battlefield
draws and the commander reads; only `execute_plan` converts steps into commands.
This is enforced by tests that snapshot every regiment's position, order and
path across a draft. Cancelling disarms pending steps but deliberately does not
recall troops already marching.

## ADR-009: Fog of war binds the Marshal exactly as it binds the player

Enemy strength is rounded to the nearest 25, lost contacts decay into stale
last-known positions, and an attack ordered against a force never seen is
refused. Without this the agent becomes an oracle and scouting stops mattering.
