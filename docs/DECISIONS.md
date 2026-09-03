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

## ADR-010: The objective is a position, not a hero unit

The battle is won by capturing the enemy king, but a king is not an entity in
`UnitPool`. He is a record holding a name, a position, a guard regiment id and a
capture bar; his position is copied from his guard's anchor each tick.

The scope rule in the brief excludes heroes, and for good reason: a hero unit
wants abilities, targeting, death handling and a special case in every system
that iterates soldiers. Modelling the objective as a position keeps all of that
out. Combat, movement, the spatial hash and the renderer's batching are entirely
unchanged, and nothing new became addressable over WebMCP — regiments are still
the only thing an agent can name.

The capture contest reads the unit arrays but never writes them, so it composes
with everything else rather than interleaving with it.

## ADR-011: Capture is rate capped, and a king rides with his guard

Two constraints keep the objective a fight rather than a race. A king moves with
his Royal Guard, so he is only reachable once that regiment is broken or drawn
off; and capture progress is capped regardless of how much strength is brought
to bear, so any attempt leaves the defender time to answer.

Without the cap, a large enough force takes a king the instant it arrives, and
the correct play becomes one undefended sprint rather than an operation. Without
the guard, the objective is a fixed point on the map and the whole battle
collapses into a footrace to it.

An army-wide morale penalty while its own king is beset is what makes defending
worth doing. It is deliberately small — 0.03 per tick against a 0.055 passive
recovery — because an earlier version of the morale system taught us how easily
a compounding penalty turns into a spiral no side recovers from.

## ADR-012: A decided battle stops the simulation

When a king falls the engine advances the tick but runs no system, and every
queued command is failed with `BATTLE_OVER`. The alternative — letting the
battle grind on behind a victory banner — makes the result a UI claim rather
than a fact about the state, and leaves the projections describing a battle that
is supposedly finished.

## ADR-013: One operation per battlefield, each with a different problem

Seven authored operations became four. The seven differed mostly in where the
same core regiments started, and four of them asked the commander the same
question — cross a line held against you — with the furniture moved.

The four that replaced them are chosen so that no two are answered the same way:
a trap that punishes the commander who springs it early, an assault through a
door that opens both ways, a rescue that is also a race to the enemy's own
sovereign, and an open field where both flanks are the commander's own to hold.
An operation that could not name a problem the other three do not pose was cut
rather than kept.

One per battlefield is the rule that sets the number. A map with no operation on
it is content nobody sees; a second operation on a map that has one has to earn
its place against the first, and none of the cut four could.

The orders of battle are shared across all three deliberately. One stable roster
is what lets a single tool surface, a single roster panel and a single enemy
commander serve every operation, and it means a Marshal that has learned one
battle knows the pieces of the next.

## ADR-014: The operation is carried in state, not looked up by id

`GameState` holds the whole `ScenarioDefinition` the engine is fighting rather
than an id that other code resolves against a table.

This began as a requirement of designed operations — there is no table entry to
look up for a battle written thirty seconds ago — but it is the better design
regardless. A module-level registry consulted mid-tick is shared mutable state
by another name: two engines in one page, one authored and one designed, would
read each other's script. Carrying the definition also let the enemy commander
seat its royal guard from the objective rather than from a written group id,
which is what allows a design to name its own regiments.

## ADR-015: A second tool surface, live only before the battle

The War Council publishes its own six tools while the home screen is up and
unregisters them, through the `AbortSignal` they were registered with, the
moment an army deploys. They are not folded into the battlefield surface.

Two surfaces rather than one falls out of what each is for. Before the battle
there is no simulation to protect, nothing hidden by fog, and the useful verbs
are *read every battlefield* and *write an operation*. After it there is exactly
one authoritative state, everything is fog-limited, and the useful verbs are
orders. A single surface would have to answer "no battle yet" or "too late" on
half its tools at any moment; two surfaces answer that once, at the boundary,
with `BATTLE_BEGUN`.

A designed operation is data, never code: named ground, bounded strengths, a
king on each side, ids unique across the whole battle, and a timetable drawn
from a closed order vocabulary. It is validated in one place,
`config/customBattle.ts`, and becomes an ordinary operation the instant it
exists — fought by the same engine, reported by the same tools, and labelled as
designed wherever it is shown.

The blank battle on the table is generated from the chosen map rather than
written for one, which is what makes the ground a choice rather than a fixture.
It also means the designed path is exercised by an ordinary human deployment on
any of the four battlefields, not only by a tool call.
