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
ends the battle outright. An army cut below a third of its strength concedes
the field instead, so a battle can also simply be won or lost on the line.

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
  annihilated. A regiment gives way with roughly a third of its men still
  standing, refuses orders, and streams for the rear; it rallies if it gets
  clear, but never back to the confidence it started with — what it lost, it
  lost. Committing a reserve at the right moment therefore matters more than
  arithmetic, and an army that has broken twice is finished even while it still
  has men on the field.
- **Terrain.** Every battlefield is built around one dividing feature and the
  few places it can be passed, which is what makes those places worth dying on:
  a river with three bridges, a volcanic spine with two gaps, a tidal channel
  with one causeway and one ford. Goldmere is the deliberate exception — nothing
  divides it at all, so both flanks are open the whole way round and the ground
  gives the commander no help. Forest, hills and villages favour defenders
  everywhere.
- **Fog.** You fight on estimates. So does the Marshal. This binds the objective
  too: the enemy king is reported at his last *sighting*, never his position,
  and until he has been seen once he is simply unknown. Fog hides *forces*, not
  *ground*: the valley itself is always drawn, because a plan has to be drawn on
  something.

## Intentionally limited scope

Seven authored operations across four authored battlefields, three deterministic
enemy command presets, one battle at a time. Maps and scenarios are *written*,
never generated: each one is hand-placed ground with a hand-written enemy script,
and the four maps all share one size, one fog grid and one camera. Non-goals:
multiplayer, accounts, persistence, campaigns, base building, technology trees,
heroes, diplomacy, procedural maps, mobile controls, per-soldier animation, and
any embedded LLM infrastructure.

Reinforcements are a manpower counter and timed waves — enough to give the top
bar something true to show and to supply the "reinforcements arrive" beat. They
are not an economy and should not become one.

## The scenario arcs

**Riverwatch** is the original measured escalation. The opening is quiet, then
the centre storms the bridge, cavalry sweeps both crossings, the siege train
comes into range, and the reserve follows.

**Broken Bridgehead** begins with the Crown vanguard already north of the river.
The enemy counterattacks quickly, forcing a choice between reinforcing the
foothold and withdrawing across a route that must remain open.

**Last Light** begins after the crossings have been lost. The army is compressed
around King Aldric and must absorb a close three-front assault before it can
create a road north.

**Cinder Road** is the first operation fought off the Vale. Ashfall Pass is a
dead volcanic spine with two gaps four kilometres apart, and the defenders in
one are too far from the other to be recalled to it. The commander's real
decision is which gap he means and which one he is only pretending to mean.

**The Ashen Gate** is the same ground from the far side: the army is already
through and above the spine, with the Crown itself standing on the wrong side of
a four-hundred-yard gap the enemy only has to reach to close.

**Goldmere Fields** removes the terrain argument entirely. Two armies form up in
open harvest country with nothing between them, both sides deliberately
cavalry-heavy. It is the operation where the envelopment rules are the whole
battle, because nothing on the map protects a flank but the men standing on it.

**The Long Causeway** cuts a tidal channel corner to corner, so its two
crossings are not a left and a right but a near one and a far one. A wing
committed to the ford is a long march from the wing on the causeway, and nothing
else on any map punishes a divided attack this plainly.

Every arc ends the same way. Once the scripted escalation is spent the enemy
commander stops trading blows along the line and drives everything he has left
at the player's sovereign, so a battle closes on a crisis rather than trailing
off into a stalemate neither side can break.

Levy, Captain, and Warlord preserve those authored arcs while changing when the
enemy commits, how often it reacts to visible contacts, how far it coordinates,
how broadly it recalls relief for its king, and how soon it makes that final
drive. Difficulty never grants hidden information or bypasses the command queue.
