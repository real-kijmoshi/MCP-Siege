# Siege — Coding Agent Directives

## Authoritative state

- There is one mutable `GameState`, owned by `SimulationEngine`.
- Human input, WebMCP, the enemy AI and fired conditionals submit typed commands.
  They never mutate state directly.
- Command handlers validate the whole command before mutating. An invalid
  command is an atomic failure that changes nothing.
- The renderer reads live state through `engine.getState()` and must only read.
  WebMCP never sees state; it sees `GameQueries` projections.

## Command and query boundaries

- All state changes cross `GameCommandPayload` and the deterministic `CommandQueue`.
- WebMCP action tools submit commands; read tools call `GameQueries`.
- `applyOrderToGroup` in `commands/handlers/shared.ts` is the single definition of
  what an order means. Do not add a second path.
- Fog-of-war filtering belongs inside `GameQueries` and `Visibility`, never in callers.
- Regiments are the only entity addressable across the WebMCP boundary. Individual
  soldiers are pool indices and must never be exposed or referenced by id.

## Determinism

- 20 ticks per second, 50 ms fixed step.
- Behaviour must not depend on wall-clock time, DOM state, render delta, or
  unordered iteration. Iterate arrays and sorted keys, never a bare `Map` order
  that callers can influence.
- Randomness must use the seeded PRNG owned by simulation state. Cosmetic
  scattering may use an index hash instead, so it does not consume that stream.
- Module-level mutable values are permitted only as scratch buffers that are
  fully reset before use. Anything that carries state across ticks belongs in
  `GameState`, or two engines in one process will interfere.

## Performance

- The simulation targets ~8,000 units. Per-tick work must stay O(units) with a
  small constant and allocate nothing in steady state.
- Units live in `UnitPool` typed arrays with a free list. Do not introduce
  per-unit objects.
- Combat uses the spatial hash; target acquisition is staggered across ticks.
- Group-level navigation only. Never run a path search per soldier.
- The renderer batches by faction and category into preallocated buffers and
  switches level of detail by zoom. Keep fills per frame in the low tens.

## Module ownership

- `src/game/simulation/`: authoritative state, engine, systems, deterministic utilities.
- `src/game/commands/`: command contracts, queue, validation, handlers.
- `src/game/queries/`: visibility-safe external projections.
- `src/rendering/canvas/`: drawing and raw input capture only.
- `src/ui/`: DOM presentation and command dispatch only.
- `src/integrations/webmcp/`: feature detection, schemas, registration, result shaping.

## WebMCP constraints

- Register through feature-detected `document.modelContext.registerTool(...)`.
- Strict JSON Schema inputs with `additionalProperties: false`, and a matching
  runtime validator. The schema guides the caller; the validator protects the game.
- Locations are named zones, never raw coordinates.
- Return structured, actionable errors that never confirm the existence of
  anything hidden by fog.
- The page must contain no chat interface, tool inspector, or Marshal panel. The
  game must be fully playable when WebMCP is unavailable.

## Verification and handoff

- Test simulation systems without a browser; `tests/` runs in node.
- Before finishing a workstream run `npm run typecheck`, `npm run test`, `npm run build`.
- Update `docs/STATUS.md` after every meaningful completed workstream.
- Do not silently expand the intentionally limited scope in `docs/GAME_DESIGN.md`.
