# Game Design

## Product promise

Siege is one large battle in which a human commander and a WebMCP Marshal share
a single legitimate command surface. The battlefield is deliberately larger than
one person can drive by hand, so delegation is a real advantage rather than a
demonstration.

## The fantasy

You command regiments, not soldiers. Around 7,200 men in eighteen formations
hold a river line. Reading the battle is meant to be possible at a glance:
colour is faction, shape is troop type, and zoomed out each regiment collapses
to a blob with a name and a morale bar.

## What makes decisions interesting

- **Counters.** Spearmen break cavalry; cavalry ride down archers and siege;
  heavy infantry grind ordinary infantry; siege devastates anything packed tight.
- **Formations.** Line for frontage, column for crossings, wedge to charge,
  square against cavalry, loose to survive bombardment. Each trades something.
- **Morale.** Most engagements are decided by regiments breaking, not by being
  annihilated. A broken regiment refuses orders and streams for the rear, and
  rallies if it gets clear — so committing a reserve at the right moment matters
  more than arithmetic.
- **Terrain.** The river is impassable except at three crossings, which makes
  the bridges genuinely decisive. Forest, hills and the village favour defenders.
- **Fog.** You fight on estimates. So does the Marshal.

## Intentionally limited scope

One scenario, one enemy, one battle. Non-goals: multiplayer, accounts,
persistence, campaigns, base building, technology trees, heroes, diplomacy,
procedural maps, mobile controls, per-soldier animation, and any embedded LLM
infrastructure.

Reinforcements are a manpower counter and timed waves — enough to give the top
bar something true to show and to supply the "reinforcements arrive" beat. They
are not an economy and should not become one.

## The scenario arc

The opening is quiet, so the controls can be learned by hand. Then, on a fixed
timeline: the enemy centre storms the bridge, cavalry sweeps the eastern
crossing, more cavalry pressures the western ford, the siege train comes into
range, and the enemy reserve follows the centre.

By roughly the four-minute mark there are more simultaneous decisions than one
person can drive. That is the designed moment: hold one front yourself and give
another to the Marshal.
