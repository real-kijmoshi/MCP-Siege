# WebMCP Medieval RTS — Coding Agent Directives

## Authoritative state

- There is one mutable `GameState`, owned by `SimulationEngine`.
- Human input, WebMCP, enemy AI, and debug tools submit typed commands. They never mutate state directly.
- Command handlers validate the whole command before mutation. Invalid commands are atomic failures.
- Renderers and UI consume immutable snapshots and command results only.

## Command and query boundaries

- All state changes cross `GameCommands` and the deterministic `CommandQueue`.
- WebMCP action tools submit commands; read tools call `GameQueries`.
- Queries return purpose-built projections, never raw `GameState` references.
- Every public entity ID is stable and serializable. Never expose Phaser objects or renderer handles.
- Fog-of-war filtering belongs inside `GameQueries`, not in callers.

## Determinism

- The simulation runs at 20 ticks per second with a 50 ms fixed step.
- Simulation behavior must not depend on wall-clock time, DOM state, render delta, or unordered iteration.
- Commands are ordered by `issuedAtTick`, then `sequence`.
- Randomness must use the seeded PRNG owned by simulation state.
- Keep simulation code pure TypeScript and independent of Phaser.

## Module ownership

- `src/game/simulation/`: authoritative state, engine, clock, deterministic utilities.
- `src/game/commands/`: command contracts, queue, validation, and handlers.
- `src/game/queries/`: visibility-safe external projections.
- `src/rendering/phaser/`: visuals and raw input capture only.
- `src/ui/`: DOM presentation and command dispatch only.
- `src/integrations/webmcp/`: feature detection, schemas, registration, and tool result adaptation only.

## WebMCP constraints

- Register through feature-detected `document.modelContext.registerTool(...)`.
- Use strict JSON Schema inputs with `additionalProperties: false`.
- Return structured, actionable results and errors without leaking hidden state.
- The normal game must work when WebMCP is unavailable.

## Verification and handoff

- Test simulation systems without Phaser.
- Before finishing a workstream run `npm run typecheck`, `npm run test`, and `npm run build`.
- Manually verify user-visible behavior when possible.
- Update `docs/STATUS.md` after every meaningful completed workstream.
- Do not silently expand the intentionally limited scope in `docs/GAME_DESIGN.md`.
