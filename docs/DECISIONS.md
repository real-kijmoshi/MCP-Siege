# Architectural Decisions

## ADR-001: Commands execute on simulation ticks

Accepted commands are assigned a deterministic sequence immediately, but handlers run only while the engine advances a fixed tick. This keeps input source and browser frame timing outside simulation behavior. WebMCP awaits the result produced by the normal fixed-step runner instead of mutating state or advancing the simulation itself.

## ADR-002: Purpose-built snapshots cross the engine boundary

The engine never exposes its mutable state reference. Renderers receive cloned snapshots; WebMCP receives still narrower query projections. This makes accidental UI mutation harder and establishes the fog-of-war enforcement point before enemies exist.

## ADR-003: Strict JSON Schema without a runtime schema dependency

Phase 1 has one small action schema. The adapter uses a standards-compatible strict JSON Schema for discovery and an explicit TypeScript validator at execution. This avoids adding a dependency solely for four bounded integer fields while still rejecting missing, extra, or incorrectly typed input.

## ADR-004: Phaser renders the world; DOM renders operational UI

The map benefits from Phaser camera and batching, while economy controls and activity history benefit from accessible semantic HTML. Neither layer owns simulation behavior.

## ADR-005: Seeded PRNG is state-owned even before random gameplay

The simulation stores both the initial seed and PRNG state from Phase 1. Future randomized systems must consume this generator, avoiding a later determinism retrofit.

## ADR-006: Native WebMCP is the integration transport

The game exposes tools through the proposed browser-native `document.modelContext` API. It does not embed a chatbot, page-side tool inspector, token widget, or backend MCP server. The host browser or agent owns tool discovery and interaction UI. A compact, collapsible Marshal drawer may report activity already produced by those tools, but it cannot execute a privileged gameplay path. Origin-isolation and `tools` permissions-policy headers are part of the application contract. Registration uses abort signals so an error cannot leave an intentionally managed partial tool set.

## ADR-007: The battlefield remains the primary interface

Phaser owns the full viewport. Compact DOM overlays provide resources, minimap, selection details, contextual commands, and optional Marshal activity without resizing the battlefield into an application dashboard. Workforce controls appear only in the Town Hall context, and diagnostics require an explicit toggle.
