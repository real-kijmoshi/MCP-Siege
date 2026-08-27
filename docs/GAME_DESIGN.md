# Game Design

## Product promise

Iron & Oath is a small medieval RTS battle in which a human commander and a WebMCP Marshal share the same legitimate command surface. The Marshal can summarize and coordinate work without hidden information or privileged state access.

## Intentionally limited scope

The target is one polished match, not a campaign or general-purpose RTS engine. The progression is:

1. Start with one Town Hall, five villagers, small resources, raw deposits, and open land.
2. Gather through direct world interaction; construct housing, economy, military, and defense buildings with workers.
3. Grow population through Houses, use timed production queues, research a few Armoury upgrades, and field mixed units.
4. Fight a predictable enemy that visibly gathers, builds, produces, defends, and attacks through the same command boundary.
5. Add fog of war, formations, obstacle-aware navigation, alerts, and balancing without replacing this loop.

The match uses food, wood, stone, and iron; villagers; a focused medieval roster; and one enemy. Multiplayer, accounts, persistence, campaigns, large technology trees, heroes, diplomacy, procedural maps, mobile controls, and custom LLM infrastructure are non-goals.

## Match opening

The player sees one Town Hall and five idle villagers surrounded by mostly open land. Nearby raw deposits invite the first direct orders. Nearly every structure visible later exists because the player or enemy constructed it. WebMCP remains an invisible browser capability supplied by the host browser or agent.
