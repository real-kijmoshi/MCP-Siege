# Game Design

## Product promise

Siege is one large battle in which a human commander and a WebMCP Marshal share
a single legitimate command surface. The battlefield is deliberately larger than
one person can drive by hand, so delegation is a real advantage rather than a
demonstration.

## The fantasy

You command regiments, not soldiers. Around 7,950 men in twenty formations hold
a river line. Reading the battle is meant to be possible at a glance: colour is
faction, shape is troop type, and zoomed out each regiment collapses to a blob
with a name and a morale bar.

## How the battle is won

**Take the enemy king.** Each side fields a sovereign who rides with his Royal
Guard. Holding the ground around the other one long enough takes him, and that
ends the battle outright. A side that loses under 85% of its strength concedes
instead, so a field can also simply be lost.

This is the rule that gives every other system a purpose. A flank is worth
turning because it opens a road to a king; a bridge is worth holding because it
closes one. It also gives the Marshal something to *plan toward* rather than a
sequence of local fights to react to — which is the difference between an agent
that answers questions about a battle and one that fights it.

A king is deliberately not a hero. He has no abilities, strikes no blows, holds
no slot in the unit pool, and is never addressable as a unit. He is a position
with a name, a guard, and a capture ring — which is why the objective could be
added without breaking the scope rule below.

Three things follow from it:

- **The guard is the lock.** A king is only reachable once the regiment around
  him is broken or drawn away, so a raid is a real operation and not a sprint.
- **Numbers cannot rush it.** Capture rate is capped, so any attempt leaves time
  for a relief column. The defender always gets a chance to answer.
- **It costs morale to be beset.** Every regiment in an army feels its king
  under threat, which is what makes a raid on a thin base worth defending
  against rather than ignoring.

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
- **Fog.** You fight on estimates. So does the Marshal. This binds the objective
  too: the enemy king is reported at his last *sighting*, never his position,
  and until he has been seen once he is simply unknown.

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

Then the enemy goes for the king — cavalry at around 400 seconds, a legion
behind it. A player who has committed everything northward finds the road to
his own sovereign open behind him, which is the bill for winning the field and
forgetting what it was for.
