# Game Design

## Product promise

Siege is one large battle in which a human commander and a WebMCP Marshal share
a single legitimate command surface. The battlefield is deliberately larger than
one person can drive by hand, so delegation is a real advantage rather than a
demonstration.

## The fantasy

You command regiments, not soldiers. Around 8,700 men in twenty-six formations
hold a river line. Reading the battle is meant to be possible at a glance:
colour is faction, shape is troop type, and zoomed out each regiment collapses
to a blob with a name and a morale bar.

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

- **Counters.** Spearmen break cavalry; cavalry ride down archers, shot, siege
  and guns; heavy infantry grind ordinary infantry; siege devastates anything
  packed tight. Handgunners are the one missile arm that goes through armour,
  which is the only thing a bow has never been able to do — bought at half a
  bow's reach and more than twice its reload, so archers standing off shoot
  them to pieces without ever being shot at.
- **The guns.** A battery outranges everything else on the field by half again,
  and the only reliable answers to one are another battery or horse brought
  round into its rear. It is not a longer-ranged siege engine: a gun has to be
  *unlimbered* to fire, so a piece that has moved this second shoots at nothing.
  Walking a battery forward with the advance is the standard mistake, and where
  it is placed is a decision made minutes before it pays. It is also the slowest
  thing on the map, and worse off a road than anything else.
- **The surgeons.** Every other system takes something away and never gives it
  back, so a regiment pulled out of the line used to be a regiment out of the
  battle for good. A field hospital is the one thing that runs the other way: a
  regiment withdrawn near it recovers its lightly wounded, its wind and its
  nerve far faster than it would alone. It does nothing at all for men in
  contact, so care is strictly what a commander buys by pulling a regiment
  *out*, and it never returns a man who has actually fallen. The hospital
  carries no weapon, holds no ground, and is the softest target on the field —
  which is what makes a raid into an army's rear worth mounting.
- **The line of fire.** A missile arm has to be able to *see* what it is
  shooting at. A shot is traced past whatever other regiments of your own stand
  in the lane: a gun or a caliver is aimed along its barrel and simply will not
  fire through your own infantry, while a bow or an engine lofts over and pays
  for it heavily in accuracy. A regiment never masks itself — its own ranks are
  drilled to shoot as a body, which the formation profile already prices — so
  what this costs is always a decision someone made about where two regiments
  stand. It is the term that makes placing missile troops the whole decision
  about them, and it gives high ground a second and larger purpose: a battery on
  a ridge shoots over its own army all day.
- **The charge.** Horse arriving at speed hits far harder than horse standing
  in a melee, and it does so exactly once. A squadron that has landed its charge
  is fighting from the next second onward and recovers its impact only by
  breaking clean off and getting back up to pace. What a charge mostly does is
  not kill: it *shakes* the formation it lands on, hardest from behind, and a
  shaken formation is one that breaks. Pulling horse out, turning it and sending
  it in again is therefore a real manoeuvre with a real reward, and cavalry
  parked in a fight is cavalry wasted.
- **Formations.** Line for frontage, column for crossings, wedge to charge,
  square against cavalry, loose to survive bombardment. Each trades something.
- **The press.** A regiment fights along its frontage, so men beyond what that
  frontage can hold are not reinforcements — they are a crowd. Pushed together
  hard enough, a formation loses half its damage, bleeds morale, and becomes the
  target every archer on the field wants. This is what stops "send everything
  through the bridge" from being the answer to every map: the gap that makes a
  crossing worth holding is the same gap that crushes the army trying to force
  it. The counters are real ones — fewer regiments at a time, loose order, or a
  second crossing.
- **Exhaustion.** Men who have been fighting for a quarter of an hour hit softer,
  steady more slowly and give ground under a press they would have held at the
  start. It is what makes a reserve worth holding rather than committing, and
  what makes relieving a spent regiment with a fresh one a real move rather than
  a tidy one.
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
  with one causeway and one ford. Men still fighting from the crossing itself
  strike at little more than half weight and can put almost no shove behind it,
  because a bridge is ground you have to get off, not ground you fight on.
  Goldmere is the deliberate exception — nothing divides it at all, so both
  flanks are open the whole way round and the ground gives the commander no
  help. Forest, hills and villages favour defenders everywhere.
- **Fog.** You fight on estimates. So does the Marshal. This binds the objective
  too: the enemy king is reported at his last *sighting*, never his position,
  and until he has been seen once he is simply unknown. Fog hides *forces*, not
  *ground*: the valley itself is always drawn, because a plan has to be drawn on
  something.

## What the Marshal is given

The Marshal shares the commander's surface, not a privileged one: it reads
through the same fog and writes through the same queue. What it does get, which
a human gets from the screen, is a way to *judge*.

- **The rules, as numbers.** The counter table, the formation profiles, the
  stances, the ground and the mechanics are published as data read out of the
  game's own tuning. An agent that has to infer the rules from prose plays a
  remembered game instead of this one; one that can read them plays this one.
  The manual is not intelligence — it is the same for both sides and says
  nothing about the battle.
- **An engagement priced before it is ordered.** The depth of the combat model
  is worth nothing if it is invisible from outside. The assessment runs the real
  multipliers over what the commanding side actually knows, counts only the men
  who would be on the front, and states what it is leaving out — the charge, the
  flank, the enemy's own formation and morale — rather than pretending to it.
- **A clock.** Marches are timed over the ground they cross, because the whole
  point of three arms at three paces is that they do not arrive together.
- **A way to wait.** Triggers already existed, but they could only fire an
  order. The same closed vocabulary now fires a *report*, so an agent can give
  an order and wait on the thing that would change its mind instead of guessing
  how long to sleep.

None of these lets the Marshal see anything the fog hides, address a soldier, or
name a coordinate.

## Intentionally limited scope

Four authored operations, one for each authored battlefield, plus the designed
operation on the War Council table — whose ground is the commander's to choose.
Three deterministic enemy command presets, one battle at a time. Maps are *written*, never generated: each one is
hand-placed ground with hand-placed roads, and the four share one size, one fog
grid and one camera. The authored operations are hand-written too — a
deployment and a timetable each. The one thing that is not hand-written is the
operation an external Marshal designs for itself, and even that is assembled
from the same named ground by the same builder, then validated before anything
is raised on it. Non-goals: multiplayer, accounts, persistence, campaigns, base
building, technology trees, heroes, diplomacy, procedural maps, mobile controls,
per-soldier animation, and any embedded LLM infrastructure.

Ten troop types, fixed at authoring time. The arms exist to make the counter
matrix worth reading, and each one earns its place by being the answer to
something no other arm answers: shot to armour, guns to anything that has to
stand still, surgeons to attrition itself. A troop type that merely does what an
existing one does slightly better does not belong here, and none of them is
bought, upgraded or unlocked — the order of battle is written into the scenario
exactly as the ground is.

Reinforcements are a manpower counter and timed waves — enough to give the top
bar something true to show and to supply the "reinforcements arrive" beat. They
are not an economy and should not become one.

## The four operations

Four, not seven — one for each battlefield. Each exists to pose a problem the
other three do not, and an operation that only changed where the regiments
started was cut rather than kept.

**I. Bridge of Knives** (River Vale) is a trap, and the deployment is the whole
operation. The centre is a corps of bows and a wall of spears standing alone at
the middle bridge, which reads to the Ashen commander as the thin place worth
crossing. Both bodies of foot are back and wide of it; both bodies of horse wait
in the woods on the flanks. A regiment that crosses a bridge arrives crowded —
too packed to swing — and a crowded regiment closed on from two sides is
surrounded as well, so the crowding and encirclement rules are what actually
decide this battle. Spring it early and you meet the Cinder Host in the open at
full strength; wait, and you meet half of it wedged on a bridgehead at half
value. It is the only operation in the game where the correct opening move is to
do nothing at all.

**II. The Ember Gate** (Ashfall Pass) is a door, and a door opens both ways.
Two gaps four kilometres apart, both held from the high ground above them, and
an army split to face both: bows and spears below Cinder Gap, the Ironbacks and
the battery below the Ashfall Gate. Force either. Four minutes in, the Cinder
Host comes *south* through the western gap and makes for the Crown Camp, so a
commander who has fed everything forward loses his king to a column he never
watched for. Leaving the Fenmen at home is a real decision with a real cost,
because the gate does not break itself.

**III. The Salt Tide** (Sunken Causeway) is a race. A night raid on the Ashen
Anchorage left King Aldric and the Kingsguard on the North Strand with the
Ironbacks and nothing else, on the far side of a tidal channel that is crossed
in exactly two places, an hour of marching apart. Every clock runs the same way:
the Ashen host is already turning on the stranded half, and their spears are
corked on the far end of the causeway so a relief column has to be paid for.
Marching to the rescue is the obvious answer. Riding for *their* king while his
host is out hunting yours is the other one, and it is not the worse of the two.

**IV. The Open Hand** (Goldmere) is a field with nothing on it. No river, no
spine, no channel — harvest country, one town, two woods, two meres, and not a
single feature that will hold a flank for you. In the first half minute both
Ashen horse wings go wide, one round each end of your line, while their foot
walks at the town. It is the operation where the envelopment rules *are* the
battle: anchor a flank on the town or on Millbrook, beat one wing before the
other arrives, or refuse a flank and give ground on purpose — but a straight
line held to the end is a line taken from three sides.

**The table** is the fifth seal on the War Council screen: a blank battle whose
ground the commander picks, which an external Marshal can rewrite through
WebMCP and a human can fight as it stands. It is *generated from the chosen
map* — two matched armies of seven regiments drawn up on whatever that
battlefield actually offers — so choosing River Vale, Ashfall Pass, Goldmere or
the Sunken Coast lays a fresh skirmish on it. It is not meant to be a good
battle; it is meant to be an honest blank one.

Every operation ends the same way. Once the scripted escalation is spent the
enemy commander stops trading blows along the line and drives everything he has
left at the player's sovereign, so a battle closes on a crisis rather than
trailing off into a stalemate neither side can break.

The commander also declines to be farmed. He will not march a regiment into
several times its own numbers standing on the objective — he halts it on the
ground it holds instead — and once he can see the player's whole weight gathered
in one place, everything of his that is clear of the fighting goes the other way,
at the sovereign that weight is no longer standing in front of. A rush is
therefore a race rather than a free win, and because he is reading his own
contacts rather than the truth, a feint moves him exactly as a real commitment
would.

Levy, Captain, and Warlord preserve those authored arcs while changing when the
enemy commits, how often it reacts to visible contacts, how far it coordinates,
how broadly it recalls relief for its king, how quickly it notices an army that
has committed itself, and how soon it makes that final drive. Difficulty never
grants hidden information or bypasses the command queue.

## Operations a Marshal writes

The War Council screen publishes its own small tool surface, live only while the
home screen is up. It exists because the most interesting thing an agent can do
with a battle game is not play one: it is design one, hand it to a human, and
watch it be fought.

A designed operation is data, never code — a battlefield, two orders of battle
placed on *named ground*, one regiment per side carrying its sovereign, and a
timetable for the enemy commander drawn from the same order vocabulary the
scripted operations use. Choosing only the ground is a smaller version of the
same act: `select_operation` with a `mapId` lays the generated blank battle on
that battlefield, which a Marshal can then read and improve on. It is validated before it exists: bounded strength, no
king-less side, no regiment on ground that is not on the chosen map, no
commander ordering a regiment nobody raised. Once built it is an ordinary
operation in every respect, fought by the same engine and reported by the same
tools, and it is drawn on the War Council table so a human can read it before
deploying it.

The designed operation is *labelled* as designed everywhere it appears. It is a
battle the game will honestly fight; it is not one the game claims to have
authored.


