# Current Milestone

Vertical slice complete — the full loop from the brief's first-milestone list
works end to end.

# Working

- Around 7,200 units in eighteen regiments across two factions, simulating at
  roughly 2.6 ms per tick against a 50 ms budget.
- Struct-of-arrays unit pool with a free list; no per-unit objects, no steady-state
  allocation, and units are never exposed outside the simulation.
- Deterministic 20 Hz simulation: identical seed and command script produce an
  identical state checksum, verified over 2,000 ticks.
- Seven formations with real trade-offs, three stances that govern how far men
  will leave the line, and a counter matrix covering seven troop types.
- Regiment-level morale with confident/stable/shaken/breaking/routing states.
  Broken regiments refuse orders, stream to the rear, and rally when clear.
- Three-state fog of war, contact memory with rounded strength estimates and
  stale last-known positions, and refusal to attack a force never seen.
- Group-level navigation over a thirteen-node zone graph; the river is passable
  only at the three crossings, so the bridges are tactically binding.
- Strategic alerts with dedupe and cooldown; zone control tracking per named zone.
- Custom Canvas 2D renderer: procedural vector terrain, batched unit drawing
  (fourteen fills for the whole army), three levels of detail by zoom, fog blit,
  combat effects, minimap, and the plan overlay.
- Full desktop controls: click and box selection, right-click context orders,
  queued waypoints, zoom, pan, control groups, pause and speed.
- Minimal UI: status strip, regiment roster, command row, transient alerts. No
  Marshal panel of any kind.
- Nineteen WebMCP tools with strict schemas and runtime validation, registered
  through `document.modelContext` with abort-signal cleanup.
- Plan Mode: draft, revise, execute and cancel, drawn over the battlefield as
  numbered arrows. Drafting is proven inert by test.
- Conditional orders over a closed eight-trigger vocabulary, armed either
  directly or as gated plan steps.
- 46 tests passing across simulation, determinism, performance, tactics, fog,
  the tool surface, and Plan Mode. Typecheck and production build clean.

# Intentionally Limited

- One scenario and one deterministic enemy; no campaign, multiplayer, base
  building, technology tree, or procedural maps.
- Navigation is group-level steering. Soldiers do not avoid one another and
  formations may interpenetrate in a melee.
- Forest, hills and the village modify combat and morale but do not block movement.
- Reinforcements are timed waves, not an economy.

# Not Yet Verified

- The end-to-end run inside a real WebMCP client. The tool surface is covered by
  tests against the handlers, and registration is tested against a stub
  `modelContext`, but no session in Chrome with the WebMCP flag or in ChatGPT's
  in-app browser has been performed from this environment.
- Visual QA in a browser. The renderer has not been seen running; there is no
  browser automation available here.

# Next Recommended Task

- Open the page in Chrome with `chrome://flags/#enable-webmcp-testing` and walk
  the acceptance list in the README, then tune the escalation timeline against
  how the battle actually feels at 1x speed.
