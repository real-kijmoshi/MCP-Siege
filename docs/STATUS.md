# Current Milestone

Combined arms pass complete. Three troop types join the order of battle -- guns,
shot and surgeons -- and each is the answer to something no arm on the field
answered before. Twenty-six regiments now muster around 8,700 men, the
production check is green at 173 tests, and an untouched battle runs about seven
minutes instead of three.

# Combined Arms Pass

## The problem

Seven troop types, and only four decisions among them. Infantry, spears, heavy
foot and horse form a closed loop that is genuinely interesting; archers, siege
and scouts hang off the side of it. Two gaps in particular:

Nothing at range could beat armour. Bows are *countered* by heavy infantry
(0.55) and siege only matches them, so the answer to plate was always to walk
something into contact with it. That made every missile regiment on the field a
softening weapon and never a deciding one.

And every system in the battle ran one direction. Men die, formations tire,
morale spent is morale lost, and a wound is permanent. So a regiment pulled out
of the line was simply a regiment subtracted from the battle, and "relieve a
spent regiment with a fresh one" -- which the design has always claimed as a
real move -- cost a commander everything and returned him nothing.

## What changed

- **Handgunners.** The one missile arm that goes through armour: half again a
  bow's damage against heavy infantry where a bow is blunted by it. Paid for at
  half a bow's reach and more than twice its reload, so archers standing off at
  two hundred paces shoot handgunners to pieces without ever being shot at.
  Volley strength reads the same formation profile archers do.
- **Cannon, and unlimbering.** A battery outranges everything else on the field
  by half again, and the only reliable answers to one are another battery
  (counter-battery is the sharpest number in the table at 1.8) or horse brought
  round into its rear, which a gun can barely hit. What makes it a different arm
  rather than a longer-ranged siege engine is that it must be *unlimbered*: any
  piece that moved this tick has its wait set back to the full deployment time,
  so a battery walked forward with the advance shoots at nothing for the whole
  march. It is also the slowest thing on the map and by far the worst off a
  road. Where the guns are placed is now a decision made minutes before it pays.
- **The field hospital.** The one thing on the field that runs the other way. A
  regiment out of contact and within reach of surgeons recovers its lightly
  wounded, sheds fatigue faster and steadies sooner. Care is capped by how many
  surgeons there are against how many men need them, so a hospital does far more
  for a battered regiment than a whole one -- which is the order they should be
  treated in. It does nothing whatever for men in contact, so care is strictly
  what a commander buys by pulling a regiment *out*; it never returns a man who
  has actually fallen; and the surgeons carry no weapon, hold nobody in place,
  and are the softest target on the field.
- **Six new regiments, three a side**, deployed on all seven operations.
  Arquebusiers, a culverin battery and a field hospital for the Crown; the Ashen
  Shot, the Black Guns and the Ashen Surgeons against them. Each operation
  places them to make its own argument -- the Bridgehead puts the hospital on
  the far bank from the fighting, Cinder Road commits a battery to each gap, and
  Goldmere puts the guns in open country where nothing stops horse getting
  behind them.
- **The enemy commander knows what he is holding.** Guns and hospitals join
  siege as regiments he will not redirect reactively: a battery sent to answer a
  contact arrives limbered and fires at nothing, and a hospital sent near one is
  simply given away. Both move on the written script instead.
- **`focus_siege` commits guns as well as engines**, and its tool description
  now warns the Marshal that a battery still marching cannot fire.
- **Two new roster readouts.** `LIMBERED` says the guns are on their teams and
  will not shoot -- the single easiest thing to get wrong with artillery, and
  nothing else on the display would have said so. `TENDED` says a hospital is
  within reach, which is what makes withdrawing a battered regiment legible as
  a move rather than a retreat. Both are on `ArmySummary`, so the Marshal reads
  them too.

## What this cost

The pool rises from ten thousand to twelve, and the armies from 7,950 men to
about 8,700. Per-tick cost is unchanged within noise -- 7.38 ms against a 7.45 ms
baseline -- because the added regiments are small and the two systems added are
both group-level passes over twenty-six records.

Battles run longer: an untouched Riverwatch now reaches a decision at about
seven minutes rather than three. That is the intended direction rather than a
regression. The scripted escalations reach as far as 460 seconds and the
commander's opportunism and final-push clocks come due between 250 and 460, so
at three minutes most of the authored arc was never being played at all. The one
consequence in the suite is that the battle-tempo test needed an explicit
timeout, since twenty-five battle-minutes of two four-thousand-man armies is
well past the default per-test budget.

## Verification

`npm run typecheck`, `npm run test` and `npm run build` all pass -- 173 tests
across 12 files, up from 153. The new suite is `tests/arms.test.ts`: every
category is fully described and uniquely tokened, shot beats armour where bows
do not, counter-battery works, a rolling gun provably cannot fire while a
standing one provably does, a battered regiment recovers materially more beside
the surgeons than away from them, care stops dead the moment contact begins, and
a hospital neither acquires a target nor pins anybody by standing in front of an
enemy regiment.

Under parallel load a long run can emit `[vitest-worker]: Timeout calling
"onTaskUpdate"` as an unhandled error. It is the reporter's RPC, not a test:
every test passes on the same run, and it predates this pass.

# Previous Milestone: Archer and Engagement Pass

Missile regiments now halt their group
anchor when an attack reaches firing distance, wheel toward a coherent threat,
and remain dressed around the formation rather than letting the anchor march
through its own firing line. Archers reach 230 world units instead of 155, and
formation choice changes volley output as well as exposure to return fire.
Ranged fire no longer masquerades as physical contact, so arrows cannot pin a
regiment or manufacture an encirclement.

## What changed

- **Missile formations fight as regiments.** Movement reads the staggered target
  acquisition from the previous combat tick without allocating. When at least
  half a regiment is missile-armed and a firing cohort has a target in range,
  an assault halts its anchor and wheels toward the coherent threat. Explicit
  move, scout, and retreat orders continue moving, so fire control does not
  reinterpret a command.
- **Archers have a useful stand-off distance.** Bow range rises from 155 to 230
  world units and vision from 430 to 500. Their quadratic range falloff remains,
  so the extra reach opens the engagement without making maximum-range fire as
  strong as a close volley.
- **Formation governs volley strength.** Line and double line give archers the
  clearest shooting files; loose order trades a little output for protection;
  block is middling; square, wedge, and especially column suppress volley
  weight. The formation menu and `GameQueries` descriptions expose those
  trade-offs through the existing profile text.
- **Fire is not contact.** Only weapons under 100 world units contribute to
  engagement pinning, pressure, and attack arcs. Archers and artillery still
  deal damage and generate combat events, but cannot hold a formation in place
  from across the field or count toward a physical surround.

## Verification

`npm run typecheck` and `npm run build` pass. The complete tactics suite passes
31/31, including the new range, volley-formation, fire-control, and no-ranged-pin
checks plus the existing envelopment, crossing, morale, and pursuit regressions.
The repository-wide run reached 147 passing tests; ten expectations in the
concurrent field-support workstream still assume ten regiments or the old army
strength, and one authored hospital anchor is impassable. Those failures are
outside this pass and are intentionally not overwritten here.

# Earlier Milestone: Marching and Command Pass

## The problem

Two things were quietly broken.

A route was planned once, from wherever the regiment stood when it was ordered,
and then never questioned. But a marching body is shoved about by the friendly
regiments around it, and the group avoidance term was uncapped — with three or
four neighbours crowded together it simply outvoted the order. A column
therefore walked a curve rather than the line it had been routed along, and
since that line had been threaded onto a bridge, it arrived at the river a few
hundred paces downstream of the crossing. There it stopped dead, because the
anchor step was rejected as impassable and nothing ever asked for a new route.
On Riverwatch a single regiment spent 3,272 ticks — nearly three minutes of an
eight-minute battle — aimed at ground it could not reach.

And difficulty was timing alone. `DifficultyDefinition` held seven numbers, six
of them clocks and radii; every commander made exactly the same decisions, just
sooner. The lobby compounded it by rendering nothing but the three titles, so
"Levy", "Captain" and "Warlord" gave a first-time player no way to tell which
was the easy one — and the stylesheet had been written for a richer button the
code never produced.

## What changed

- **A march is audited, not just planned.** A group carries `stallTicks` and
  `lastReplanTick`. Progress is measured *along the line to the waypoint*, so a
  regiment walked sideways at full pace registers as stalled rather than as
  moving. Once it has stopped getting anywhere, or once a staggered per-group
  audit finds its current leg no longer runs over open ground, `Navigation` is
  asked for a fresh route. Only the current leg is replanned, so queued
  waypoints and deliberate detours survive. Both triggers are rate-limited: this
  is recovery from a stale plan, not a search per tick.
- **Avoidance can deflect a march but not overrule it.** The friendly-regiment
  push is summed and then clamped below the unit-length steering vector, so the
  waypoint always decides where a group is going. Two exactly co-located anchors
  now separate along both axes instead of sliding down one.
- **A blocked step slides instead of stopping.** A column that clips a bank
  keeps moving along the obstacle while the re-route is arranged.
- **Soldiers stay out of the water.** Unit positions live in `Float32Array`, but
  the passability check was run on the wider intermediate, so a man wedged
  exactly on the lip of a bridge could pass the check and be written a few
  ten-thousandths the other side of it. The check now tests what will actually
  be stored.
- **Three commanders, not three clocks.** `DifficultyDefinition` gains
  `declineRatio` and `declineMass` (how steep the odds must be before he turns
  back), `massedAssault` (how many regiments he puts on one objective at once)
  and `withdrawSpentBelow` (whether he relieves a worn regiment).
- **He masses instead of queueing.** Free regiments used to each answer whatever
  contact was nearest them, which meant the enemy never attacked anything — it
  queued, and a player massed at one crossing beat it a regiment at a time. The
  commander now picks a point first: the heaviest ground a lone regiment would
  refuse and a handful together would not, both bounds read through the same
  difficulty-scaled `isHopeless`. Whatever is left over falls back to answering
  the nearest threat, so at `massedAssault: 1` this degrades exactly to the old
  behaviour, which is what a levy does.
- **He relieves worn regiments.** Above the easiest tier, a regiment down past a
  share of its strength and clear of the fighting is pulled back to rally rather
  than left standing to be finished. The threshold sits well above collapse on
  purpose: a regiment that has actually broken is routing, and a routing
  regiment accepts no orders from anybody.
- **The lobby says which is which.** Each choice renders the commander's title
  with its plain tier — Easy, Medium, Hard — under it, against the stylesheet
  that was already there, and the descriptions now say what he actually does
  rather than how fast he does it.

## What did not change

The doomstack rush is still strong. Measured against the same six battles before
and after, outcomes moved within noise (4-2 to the player before, 5-1 after) and
battles still reach a decision in roughly three minutes, which is well before the
commander's opportunism and final-push clocks come due. Fixing navigation helps
the attacking column more than the defence, so this pass is close to
balance-neutral on that question. Rebalancing rush-versus-defence is its own
workstream; `tests/_crowdprobe.test.ts` is the harness for it.

## Verification

`npm run typecheck`, `npm run test` and `npm run build` all pass — 153 tests
across 11 files. Two new suites carry the work: `tests/navigation.test.ts` (every
zone pair on every map routes over open ground; no regiment is left aimed at
unreachable ground for more than ten seconds; no group or soldier stands on
impassable ground) and `tests/difficulty.test.ts` (the tiers are ordered, a
warlord masses where a levy queues, and only the harder commanders relieve a worn
regiment). Both marching assertions were confirmed to fail against the previous
`Movement.ts` and pass with it.

# Submission Release Pass

- **Fair first contact.** The battlefield now opens paused under the first-orders
  card. Beginning explicitly, choosing a speed, issuing a human command, or issuing
  an executable Marshal command starts the clock; drafting and revising a plan
  remains genuinely inert. A player no longer spends Riverwatch's brief quiet
  opening reading instructions.
- **A battle has an ending, not just a modal.** The outcome card records elapsed
  time, survivors, losses, and surviving regiments, then names its actual action:
  return to the War Council.
- **Interaction hardening.** Losing window focus or a pointer capture clears held
  pan and drag state, Space key repeat cannot strobe pause, roster selection is
  exposed with `aria-pressed`, focus survives live roster refreshes, and the final
  dialog traps keyboard focus on its available action.
- **Submission facts are current.** The README now reflects the 139-test suite and
  current production bundle size. Browser verification covered every operation in
  the council, the paused opening, selection and paused command acknowledgement,
  all 21 registered tools, a complete eight-minute accelerated battle, the result
  report, and return to the council with no console errors.
- **Verification.** `npm run check` passes 139 tests across 9 files, typecheck, and
  the production build. `npm audit --audit-level=high` reports zero vulnerabilities.

# Earlier Milestone: Massed Attack Pass

Numbers alone no longer decide a battle. Men packed into one gap are crushed and
fight badly, troops in prolonged contact wear out, an assault still fighting from
a crossing strikes at little more than half weight, and the enemy commander
refuses to be farmed — he declines hopeless assaults and marches on the player's
sovereign the moment the player's army commits itself to one place.

# Massed Attack Pass

## The problem

Putting every regiment onto the central bridge and walking through was strictly
correct on every divided map. Mass had no cost: nothing punished stacking
regiments on one another, a bridge was a slightly slower piece of open field,
troops never tired, and the enemy commander both fed his own regiments into the
mass a formation at a time and never noticed that the rest of the field had been
abandoned. The battle it produced was arithmetic, not a decision.

## What changed

- **The press.** `Combat` samples the density of *friendly* men around each
  soldier, staggered across ticks, and folds it into `group.crowding`. A
  formation at its own spacing reads zero; regiments stacked on one another, or
  compressed onto a bridge, read one. A crushed formation loses half its damage,
  bleeds morale, and takes far heavier arrow and siege casualties. Loose order
  and fewer regiments at a time are the answers, and both are real moves.
- **Exhaustion.** A new `Fatigue` system, group-level and one pass over roughly
  twenty records, accrues with contact and with marching and sheds while standing
  out of both. Spent troops hit softer, steady more slowly and lose their footing
  under a press — which is what finally makes a reserve worth holding rather than
  committing on the first minute.
- **The crossing is ground you have to get off.** An attacker still fighting from
  inside the barrier delivers 60% damage against a defender who is not, and puts
  only 40% of his weight behind the shove, so a large enough column can no longer
  simply bulldoze a blocking line off the far end.
- **The commander declines to be farmed.** He will not march a regiment into
  3.5 times its own numbers standing on the objective; he halts it where it
  stands instead. Past an early, difficulty-scaled point he also watches where the
  player's sighted weight actually is, and once it is gathered in one zone he
  sends everything clear of the fighting at the player's king. He reads his own
  contacts, never the truth, so a feint moves him exactly as a commitment does.
- **Both conditions are visible.** The roster carries `CRUSHED` and `SPENT`
  tokens and a third bar reading vigour beside strength and morale;
  `get_armies` reports `crowded`, `fatigue` and `spent`, and the overview's
  attention list names regiments that need room or relief.

## Where it lands

`npm run test:balance` replays an all-in rush on the central bridge against a
measured defence, three seeds each, and prints both.

The rush's cost turns out to be highly sensitive to one constant outside this
pass, `CONTACT.encirclementDamage`. Measured on Captain across seeds 11, 22 and
33:

| `encirclementDamage` | Rush result | Army left of ~4,000 |
| --- | --- | --- |
| 1.1 | lost 2 of 3 | 1,312 – 1,933 |
| 2.5 | won 2 of 3 | 1,336 – 3,389 |

At 1.1 the pass does what it set out to do: forcing the whole army through one
gap costs roughly two thirds of it and loses more often than it wins. At 2.5 a
mass that engulfs a regiment collects a 3.5x multiplier for doing so, which
hands most of that back — the rush finishes inside three minutes having lost
about a sixth of its strength. Coupling the envelopment bonus to the attacker's
own crowding was tried and rejected: a deliberate four-wing envelopment spikes to
full crowding while its wings converge, so the coupling punished the manoeuvre it
was meant to reward. **If the rush should stay expensive, this constant wants to
come back down toward 1.1–1.5.**

# Gameplay Rescue Pass

## Playability and combat

- **No soldier is stamped into water at deployment.** Scenario construction now
  validates every formation slot and moves the regiment the shortest deterministic
  distance that fits its full footprint on passable ground. All seven deployments
  are covered by unit-level passability checks.
- Broad formations compress their blocked files onto the regiment anchor while
  crossing a bridge, ford or gap, then dress back into formation on the far side.
  Navigation also falls back to a passability-grid corridor when an authored zone
  route cannot carry the formation, removing the observed dead march.
- Orders queued while paused are validated and acknowledged immediately without
  advancing simulation systems. March speed and turning are brisker, and the first
  Riverwatch assault begins at 18 seconds instead of leaving forty empty seconds.
- True multi-sided envelopment now scales nonlinearly and decisively outperforms a
  frontal grind. Arrow flights travel across the field; melee contact sparks; siege
  impacts retain a hot core, shock ring and smoke halo for long enough to read.

## Battlefield identity and interaction

- Removed the full-screen debug vocabulary: permanent zone circles are gone,
  roads use curved worn paths, river flow is visible, crossings follow the barrier
  angle and carry deck detail, and hills use irregular contours.
- Procedural scatter is seeded per map rather than identically. Ashfall uses lifted
  volcanic earth and crags, Goldmere uses bright harvest strips and open flanks,
  the Sunken Coast uses cold tidal ground and a diagonal channel, while River Vale
  remains green and river-led.
- The War Council no longer recolours one River Vale image four times. Ashfall,
  Goldmere and the Sunken Coast have separate authored SVG command maps matching
  their live topology.
- Hovering a named place highlights its boundary and explains its tactical effect.
  Selecting one regiment also reports its zone, current terrain, exact defensive,
  movement or ranged benefit, role matchups and real order route.
- Strategic zoom draws oriented regiment footprints instead of thousands of
  sub-pixel dots. Selection routes show real waypoints and mass orders collapse to
  one destination marker instead of a map-wide spiderweb.

## WebMCP and verification

- Battle overview projections now distinguish unobserved fronts from advantage,
  expose attention items and next actions, and include current orders and targets.
  Action schemas discriminate target requirements, reject malformed targets before
  queueing, and plan steps receive safe immediate defaults when omitted.
- Production typecheck and build pass. The default suite passes **133 tests in 9
  files**; the full opening army measures **4.58 ms/tick for 7,950 living units**,
  well inside the fixed 50 ms budget. Long output-only balance and crowd probes are
  isolated under `npm run test:balance` rather than the default worker pool.

# Interface Pass

## War Council

- **The commitment is always on screen.** The briefing column sized its two rows
  as fixed percentages of a height its own content overflowed, so on a 1044px
  window DEPLOY ARMY sat 27px below the fold with nothing to scroll it into
  view. The battle order now takes the height it needs and the portrait absorbs
  the rest.
- The operation ledger is a real scroll container — it may be shorter than its
  seven entries instead of pushing the council off the bottom of the screen —
  and no longer shows a horizontal scrollbar it never had anything to scroll.

## The battle screen

- **The status strip reads as one instrument.** Brand, then the four figures in
  a ruled cluster with tabular numerals so a changing number does not shift the
  row it sits in, then speed and WebMCP availability behind a divider. Your men
  are counted in the player's blue and the enemy's in his red, which is the one
  distinction the strip has to make instantly.
- **The control legend folds.** It used to sit open over the top-left of the
  field for the whole battle — the corner a flank march is watched from. It is
  now a `<details>` tab that opens on click or keyboard, and what it opens into
  is five labelled rows (select, order, camera, groups, time) rather than one
  run-on line. It also documents controls that existed and were never written
  down: SHIFT add, SHIFT+RMB queue, ESC clear, F selection, control groups.
- **The roster says how big the army is.** The heading carries regiment and man
  counts, it stays put while the list under it scrolls, names are left-aligned
  behind the troop token instead of drifting to the middle of the row, counts
  are tabular, and the selected regiment is marked on the edge of the row as
  well as behind it. A regiment in contact and one coming apart use that same
  edge, so the roster can be read down one column.
- **An order that can be given no longer looks like one that cannot.** Enabled
  command buttons carry a full border and a lit glyph and lift on hover; a
  disabled one drops to a flat plate with no edge at all. Attack reads warm.
- **The counter matrix is no longer truncated.** It was being cut in half inside
  a 300px column — "Infantry: strong vs archers, siege, scouts · w…" teaches
  nothing — and now sits after the command row, in the space to its right that
  was empty at every window size.
- **The field has an edge.** Outside the map the canvas carries the same colour
  as unexplored ground, so on a wide window the ends of the country read as a
  hole in the drawing. A one-pixel boundary is now stroked around the world.

# Navigation, Physics and Combat Pass

Regiments choose credible lines of march, move as bodies with momentum and local
space, and physically gain or yield ground in a fight. The work stayed inside the
existing scope: no new unit identities, commands, tools, maps or scenario rules
were added.

## Navigation

- **Routes optimize marching cost, not hop count.** The zone search now weighs
  distance, difficult terrain and authored roads. A road can win over a shorter
  forest or hill route, while every candidate leg is still checked against the
  actual passability geometry.
- **A route fits the regiment using it.** Orders pass a capped formation
  footprint into navigation. Three-lane clearance sampling rejects paths whose
  centreline is dry but whose ranks would clip a mere, ridge or river bank.
- **Paths are smoothed after they are proven legal.** The route keeps only the
  obstacle and crossing corners it needs instead of marching through every zone
  centre. Tests cover both whole-polyline passability and a tangent route whose
  anchor clears a mere but whose formation does not.

## Movement and physical contact

- `UnitPool` now carries velocity in typed arrays. Infantry, cavalry, scouts and
  engines have distinct acceleration, footprint, mass and charge traits; these
  remain pool indices and never cross the regiment-only external boundary.
- Soldiers accelerate, brake and retain momentum rather than teleporting one
  speed step at a time. Formations wheel toward a new heading, lagging ranks
  catch up, and forest, hill, village and crossing ground change pace by troop
  role. Cavalry and siege are punished most by cramped ground.
- A preallocated spatial-hash separation pass stops different friendly or enemy
  regiments collapsing into one point. It is staggered across four deterministic
  index cohorts, as target acquisition is, because velocity carries the response
  between ticks. Formation slots already solve spacing inside one regiment.
- Friendly regiment anchors steer apart when marching into the same space, so
  crossings form queues and nearby columns flow instead of stacking exactly.

## Combat

- **Charges carry real momentum.** Melee damage reads the attacker's live speed,
  mass and charge power. Cavalry arriving at full pace hits far harder than
  cavalry already standing in a scrum; a defensive spear front or square braces
  most of that shock when it arrives from the front.
- **Lines move under pressure.** Every melee contact contributes a physical
  impulse to the defending regiment. Numbers, mass and approach speed drive it;
  formation, morale and stance resist it. Yield is capped per tick and cannot
  push an anchor onto impassable ground.
- **Ground and distance matter to missiles.** Ranged damage falls toward maximum
  range, hill fire gains an advantage, forest breaks up missiles and cavalry,
  and villages and hills offer distinct protection rather than one generic
  defensive-terrain multiplier.
- Damage receives small seeded variation, so ranks no longer resolve as
  identical metronomes while replay determinism remains exact. Cosmetic combat
  sampling is now derived from unit index and tick, removing its old
  cross-engine module counter.
- Pinning engages sooner and holds harder, while pursuit damage is slightly
  stronger so routed formations remain vulnerable to cavalry sent after them.

## Verification and measured result

- 119 default tests pass, including deterministic checksums, interleaved engines
  on different maps, command boundaries, fog safety, formations, charge and
  bracing, pressure, collision separation, navigation clearance and all seven
  operations reaching a decision. The seven long balance probes were also run
  manually after the pass.
- Full opening-army performance is **3.43 ms/tick for 7,950 living units** against
  the 50 ms budget. The densest Long Causeway probe completes in 25.8 seconds
  alone after collision staggering, down from 70.7 seconds in the first physical
  solver iteration.

| Operation | Ends | Result | Player | Enemy |
| --- | ---: | --- | ---: | ---: |
| Riverwatch | 402s | player | 3027/3950 | 2698/4000 |
| Broken Bridgehead | 295s | player | 2169/3950 | 1359/4000 |
| Last Light | 178s | enemy | 2323/3950 | 3493/4000 |
| Cinder Road | 326s | player | 3424/3978 | 1424/4200 |
| The Ashen Gate | 299s | enemy | 1275/3850 | 1870/4000 |
| Goldmere Fields | 262s | enemy | 1346/3985 | 1882/4045 |
| The Long Causeway | 392s | enemy | 1343/3970 | 2345/4000 |

# Maps and Operations Pass

- **A map is data.** `config/maps.ts` holds four `BattleMapDefinition`s: named
  zones, the navigation graph, roads, the one dividing feature and the few places
  it can be passed, standing water off it, and the colour of the earth.
  `simulation/Zones.ts` no longer *is* a map; it reads the one being fought over.
- **The dividing feature is generalised.** A barrier is a centreline of
  `baseY + slope · x` plus a sum of sines, a half-width, and a kind. That is
  enough for a level river, a level volcanic spine, and a tidal channel cut
  corner to corner, and it never reads as a drawn straight line. Maps may also
  carry meres — standing water away from the barrier, impassable, and belonging
  to no zone — or no barrier at all.
- **The active map is a cache, not a second source of truth.** It is
  re-established from `GameState.mapId` before every tick, every dispatch and
  every query, so two engines on two maps in one process cannot read each other's
  ground. Proven: River Vale run alone for 400 ticks and River Vale interleaved
  tick-for-tick with a Goldmere battle reach the same state checksum.
- **The tool surface narrows to the ground in front of it.** `ZoneId` is still
  one static literal union across every map — the command contracts need it —
  but the WebMCP schemas are now built per battle, so `order_group` on Goldmere
  offers Goldmere's thirteen names and nothing else. Runtime validation checks
  the same list, so a location from another battlefield is refused rather than
  marched to.
- **The renderer follows the map.** Terrain rebuilds when the battle is
  somewhere else, draws a ridge as rock rather than water, draws meres, and
  merges an authored ground tint over the palette, so ash country is not the
  colour of harvest country.

# The Four Battlefields

- **River Vale** — unchanged: a slow river with three crossings.
- **Ashfall Pass** — a dead volcanic spine with two gaps four kilometres apart.
  A gap is reachable only from the ground directly below and above it: a column
  approaching at an angle meets the rock long before it meets the gap, which the
  map tests caught and which is now the shape of the graph.
- **Goldmere** — open harvest country with no barrier at all, two impassable
  meres, and both flanks open the whole way round. The map where the
  envelopment terms are the entire battle.
- **Sunken Causeway** — a tidal channel on a diagonal, so its two crossings are
  a near one and a far one rather than a left and a right.

# The Seven Operations

Riverwatch, Broken Bridgehead and Last Light are unchanged. New:

- **Cinder Road** — assault Ashfall Pass. The defenders of one gap are too far
  from the other to be recalled to it.
- **The Ashen Gate** — the same ground from the far side, with the Crown across
  the spine and one road home behind it.
- **Goldmere Fields** — a cavalry-heavy pitched battle in the open.
- **The Long Causeway** — one raised road, one ford, and a long march between.

Measured with the same crude scripted commander on Captain — throw four
regiments at the first crossing, then drive everything at the enemy command seat:

| Operation | Ends | Result | Player | Enemy |
| --- | --- | --- | --- | --- |
| Riverwatch | 379s | enemy | 2641/3950 | 3220/4000 |
| Broken Bridgehead | 362s | enemy | 1525/3950 | 2074/4000 |
| Last Light | 210s | enemy | 2414/3950 | 3267/4000 |
| Cinder Road | CINDER | player | CINDERP | CINDERE |
| The Ashen Gate | 442s | player | 1390/3850 | 1354/4000 |
| Goldmere Fields | 255s | enemy | 1354/3985 | 2134/4045 |
| The Long Causeway | 285s | enemy | 1336/3970 | 2737/4000 |

Every operation reaches a decision, and six of the seven punish a plan this
blunt. Cinder Road is the exception and is deliberately the gentler introduction
to a new map, but see *Not Yet Verified*.

# Earlier: Contact

Contact pass complete. Position now decides fights. Before it, a battle was two
damage pools draining into each other: an enemy column walked straight through a
blocking line without slowing, a regiment taken in the rear fought exactly as
well as one facing its enemy, an army encircled and crushed from four sides died
no faster than one fed into a single front, and men who had already broken
strolled off the field untouched. Manoeuvre — the expensive thing a commander
arranges — bought nothing over simply having more men. It does now.

- **Formations in contact are pinned.** A body of men fighting to its front
  keeps a twelfth of its march. It has to beat what is in front of it before it
  can go past, which is what makes holding a crossing worth doing. Measured:
  a five-hundred-man column crosses the map unopposed, and is stopped dead and
  ground down by a five-hundred-man spear line that loses under a fifth of its
  own strength. Troops already routing, and troops under an explicit order to
  withdraw, are exempt — disengaging is a decision, not a bug.
- **Encirclement is measured and it is decisive.** `Combat` buckets every man
  in contact into one of eight arcs around the formation he is pressing, so a
  regiment knows how far round it the attack has come. Beyond a plain frontal
  fight this raises damage taken by up to ninety percent and triples the morale
  penalty. Measured: six hundred attackers arriving from four quarters destroy a
  six-hundred-man regiment roughly twice as fast as the same six hundred
  arriving along one face.
- **Blows land somewhere.** A strike arriving outside the defending formation's
  frontal cone does thirty percent more damage, and one from behind fifty-five
  percent more. Getting cavalry round a flank is now paid for in the ledger and
  not only in morale.
- **A rout is where an army is destroyed.** Broken men neither fight nor chase,
  and take nearly double damage while they run.
- **A melee no longer stalls when the enemy in front of you dies.** A man with
  no target re-acquires on a three-tick stride rather than the ordinary eight.
  In heavy fighting targets die every few seconds, and the old stride left a
  third of the army's output on the floor exactly where the press was thickest —
  which is the arithmetic reason overwhelming numbers never felt overwhelming.
- **The commander can see it.** Every group reports `pinned` and `surrounded`
  through `GameQueries`, so the roster marks them and `get_armies` tells the
  Marshal; being surrounded raises a critical alert of its own.
- Simulation cost is unchanged: 600 ticks at 7,950 units in 1.9s, 3.2 ms/tick
  against a 50 ms budget.

# Earlier: Playability and Battle Feel

Playability and battle-feel pass complete. The systems were all present and
correct but the battle was neither readable nor decidable: the map outside your
own vision was an opaque black void, troop type — the thing the whole counter
matrix turns on — appeared nowhere in the interface, stance had no control at
all, and an untouched battle ran for twenty minutes and ended in nothing at
all. All four are fixed, and battles now reach a decision.

# This Pass

## Readability and control

- Fog hides forces, not ground. The veil is a translucent haze rather than an
  opaque black, on both the battlefield and the minimap, so the valley can be
  read and a plan can be drawn on it. Units and contacts are still gated by
  `visibilityAt` exactly as before; the intelligence contract is untouched.
- Troop type is visible everywhere it matters: a colour-coded three-letter
  token on every roster row, on every friendly and every *seen enemy* map label,
  and in the selection readout — which also spells the counter matrix out in
  words ("Infantry: strong vs archers, siege, scouts · weak to heavy infantry").
- Map labels no longer collide. Screen-space occupancy is claimed in priority
  order — selected, then in contact, then largest — so a strategic zoom reads
  instead of turning into overlapping mush.
- A pulsing contact ring marks any regiment taking losses, at every zoom, which
  is the one mark that answers "where is the battle" from across the map.
- Stance has a control. It is the third pillar of the tactical model and was
  previously reachable only over WebMCP.
- Controls a strategy player expects: right-drag pans and right-click orders
  (release-in-place, so a misclick can be taken back), Ctrl+right-click is
  attack-move, Ctrl+A selects the army, Tab cycles regiments, Z/X zoom, H homes
  on your king, alerts are buttons that fly the camera to the ground they name,
  and double-clicking a roster row centres on it.
- The opening frame is fitted to the player's own deployment rather than a fixed
  centre and zoom, so no scenario opens with regiments off the edge.
- A dismissible opening-orders card carries the objective and the three things
  worth knowing across the cut from the War Council, and leaves on the first
  order given.

## Battle feel

- Regiments break instead of dying. Casualty pressure was weighted so weakly
  that a regiment cut from 900 men to 35 still reported 83% morale — the morale
  layer was decoration and every engagement was mutual annihilation. A regiment
  now gives way with roughly a third of its men still standing, and a bloodied
  one can no longer recover to full confidence: what it lost, it lost.
- Battles reach a decision. An enemy regiment that finished a scripted assault
  kept `attack_zone` as its order forever and was never considered again, so
  both armies ground to half strength and simply stopped. A group that has
  arrived, has no waypoints, and is out of contact is now available for new
  orders, and past the scripted escalation the enemy commander drives everything
  he has at the player's king.
- An army concedes below 34% of its strength rather than 15%, which no
  engagement ever reached.
- Measured over all three operations: an aggressive player wins Riverwatch
  comfortably on Levy (79% surviving), hard on Captain (43%), and by a hair on
  Warlord (37% against 34%); the same script loses Last Light outright.

# Working

- War Council map previews now call out Crown spawn, Ashen line, and the
  objective with labeled tactical markers and a compact legend.
- Navigation now validates every waypoint leg against passable terrain and
  deterministically searches one-zone detours when a zone's broad footprint
  hides a river obstruction, preventing same-zone orders from marching through
  water.

- Around 7,950 units in twenty regiments across two factions, simulating at
  roughly 1.6 ms per tick against a 50 ms budget.
- A cinematic pre-battle War Council composed as campaign ledger → battlefield
  portrait → battle order → deploy. Three spare mission entries select a large
  illustrated command map with army formations, standards, objectives, and
  scenario-specific attack routes. Briefing is limited to two orders, three facts,
  one compact enemy-commander control, and the deploy commitment.
- Three materially different authored openings: Riverwatch's measured river
  defense, Broken Bridgehead's exposed northern foothold, and Last Light's
  compressed defense of the Crown. Each has its own deployment and enemy script.
- Levy, Captain, and Warlord change deterministic assault timing, reaction
  cadence, response radius, and royal relief radius without bypassing fog or the
  command queue. The chosen operation and difficulty appear in both the battle
  header and the WebMCP battle overview.
- A win condition: take the enemy king by holding the ground around him, or
  break his army entirely. Kings ride with their Royal Guards, capture is rate
  capped, a besieged king costs his whole army morale, and a decided battle
  stops the simulation and refuses further orders rather than leaving a Marshal
  call pending.
- Struct-of-arrays unit pool with a free list; no per-unit objects, no steady-state
  allocation, and units are never exposed outside the simulation.
- Deterministic 20 Hz simulation: identical seed and command script produce an
  identical state checksum, verified over 2,000 ticks.
- Seven formations with real trade-offs, three stances that govern how far men
  will leave the line, and a counter matrix covering seven troop types.
- Regiment-level morale with confident/stable/shaken/breaking/routing states.
  Broken regiments refuse orders, stream to the rear, and rally when clear.
- Three-state fog of war drawn as a translucent veil, contact memory with
  rounded strength estimates and stale last-known positions, and refusal to
  attack a force never seen.
- Group-level navigation over a thirteen-node zone graph; the river is passable
  only at the three crossings, so the bridges are tactically binding.
- Strategic alerts with dedupe and cooldown; zone control tracking per named zone.
- Custom Canvas 2D renderer: procedural vector terrain, batched unit drawing
  (fourteen fills for the whole army), three levels of detail by zoom, fog blit,
  combat effects, minimap, and the plan overlay.
- Full desktop controls: click and box selection, right-click context orders and
  attack-move, right-drag and WASD panning, queued waypoints, zoom, select-all,
  regiment cycling, control groups, pause and speed.
- Minimal UI: status strip, regiment roster, command row, transient alerts, and
  a dismissible opening brief. No Marshal panel of any kind.
- Twenty-one WebMCP tools with strict schemas and runtime validation, registered
  through `document.modelContext` with abort-signal cleanup.
- Plan Mode: draft, revise, execute and cancel, drawn over the battlefield as
  numbered arrows. Drafting is proven inert by test.
- Conditional orders over a closed nine-trigger vocabulary, armed either
  directly or as gated plan steps.
- Tests passing across simulation, scenarios, difficulty, determinism,
  performance, tactics, envelopment and pursuit, morale, battle tempo, fog, the
  objective, the tool surface, and Plan Mode. Typecheck and production build clean.

# Intentionally Limited

- Three authored scenarios on one map and three deterministic enemy presets; no
  campaign, multiplayer, base building, technology tree, or procedural maps.
- Navigation is group-level steering. Soldiers do not avoid one another and
  formations may interpenetrate in a melee. Formations block each other at the
  group level, through the pinning term, rather than by per-soldier collision.
- Forest, hills and the village modify combat and morale but do not block movement.
- Reinforcements are timed waves, not an economy.

# Not Yet Verified

- Chrome reports all 21 WebMCP tools registered and the handler surface is
  covered in node, but a complete external model-driven battle session has not
  yet been performed.
- Battle length and difficulty feel are now measured by a scripted aggressive
  player across all three operations rather than by hand, but no human has
  played a full battle at 1x since the retune.

# Next Recommended Task

- Play a full battle at 1x since the contact pass. Envelopment and pinning are
  measured in isolation and the scripted battle-tempo tests still reach a
  decision, but nobody has yet fought a battle where the plan is to surround
  something, and the new terms are strong enough that the enemy AI may need to
  learn to answer them.
- Run one complete model-driven WebMCP session end to end. The tool surface is
  covered in node and Chrome reports all 21 tools registered, but no external
  model has fought a whole battle through it yet.
- A player who issues no orders at all still does not reach a decision inside
  thirty minutes: he holds his line, the enemy bleeds down to about half, and
  nothing closes it out. That is a defensible reading of "you are a spectator if
  you spectate", but it is worth a deliberate decision rather than a default.
