# Current Milestone

The War Council, the operations and the Marshal's own battle. The home screen
has been redrawn as part of the game rather than a screen in front of it, the
seven authored scenarios have been replaced by four written from scratch — one
for each battlefield — and an external Marshal can now design an operation of
its own, on ground of its own choosing, and fight it. No simulation rule
changed: combat, morale, fog, the objective and the command queue are untouched.

# Pixel-Art Unit Shading Pass

Detailed-zoom soldiers were flat single-colour blocks — a square, circle,
triangle or diamond per category, all one shade. `UnitLayer` now adds a
contact shadow at the feet and a metal glint at the crown of every detailed
unit, drawn from the same shadow and stone-light inks the terrain and keeps
already use. Both accents are batched across every category and faction in
one pass each, so the change costs exactly two more `fill()` calls for the
whole battlefield regardless of how many troop types are on the field — the
existing per-category body fills, and the low-LOD block and blob paths, are
unchanged. No simulation, command, query or WebMCP behaviour is touched.

# The War Council

- **One material vocabulary.** The lobby was a serif war room over a
  photographic map, with soft shadows and rounded plates — a different game
  from the one behind it. It is now built from the same oak, iron, stone and
  parchment as the command screen, in the same monospace, with hard steps at
  every edge and gold reserved for the one thing that is chosen.
- **A new logo.** `SIEGE` is hand-set on a five-by-seven pixel grid and
  outlined in the terrain's own shadow ink, and the Crown crest — a three-
  pointed crown over a shield — is drawn from the same sprite sheet as the
  battlefield. The favicon is that crest, emitted as pixel rectangles. Nothing
  on the screen is set in a typeface the battlefield has never seen.
- **The portrait is drawn, not photographed.** Four hand-made map images have
  been deleted. `ui/LobbyMap.ts` paints the selected operation from map data —
  ground dithered between two greens, woods and hills speckled with the art
  hash, the barrier and its crossings, the roads, both orders of battle as
  blocks sized by weight, and a crown on each king — onto a fixed 320 × 200
  buffer that CSS scales up without smoothing. Every operation gets a true
  portrait, including one an agent wrote thirty seconds ago.
- **The Marshal is visible before the battle.** The header carries a status
  seal for the War Council tool registration, so a commander can see whether an
  agent is present while there is still something for it to design.

# Four Operations, Written From Scratch

Seven operations became four — one for each battlefield — each posing a problem
the other three do not. The orders of battle were rewritten with them: twenty
regiments under new ids, and one stable roster across every operation so a
single tool surface and a single enemy commander still serve all of them.

- **I. Bridge of Knives** (River Vale) — a trap. The centre is bait; the crowding
  and encirclement rules do the killing on the bridgehead. The correct opening
  move is to do nothing.
- **II. The Ember Gate** (Ashfall Pass) — a door that opens both ways. Force one
  of two gaps knowing their centre comes south through the other at four
  minutes, at your camp.
- **III. The Salt Tide** (Sunken Causeway) — a race. Your king is stranded on the
  far shore with one regiment; their king is thinly guarded because his host is
  out hunting yours.
- **IV. The Open Hand** (Goldmere) — no feature on the field. Both their horse
  wings go wide in the first half minute, one round each end of a line with two
  open ends.

# Operations a Marshal Designs

- **A second tool surface.** While the home screen is up the page publishes
  `list_operations`, `describe_battlefield`, `design_operation`,
  `review_operation`, `select_operation` and `launch_operation`. It is
  unregistered through its own `AbortSignal` the moment an army deploys, and
  every tool then answers `BATTLE_BEGUN`.
- **The table has ground of its own.** The blank operation is no longer a
  written deployment on one map: it is generated from whichever battlefield is
  chosen — front-most central zone for the foot, the western and eastern
  extremes for the horse, the muster for the guard, and a plain escalation for
  the enemy. A human picks the ground from the War Council card; a Marshal
  picks it by passing a `mapId` to `select_operation`. Either way what lands on
  the table is a legal battle that can be deployed as it stands.
- **A design is data, never code.** `config/customBattle.ts` is the only door:
  regiments are placed by zone name, strength is bounded (3–12 regiments a side,
  20–1,200 men each, 4,200 a side), exactly one regiment a side must carry its
  king, ids are unique across the whole battle rather than merely within a side,
  and the enemy timetable may only order regiments the design raises, with
  orders drawn from a closed vocabulary. Every violation is a refusal carrying
  the reason and a suggestion, never a silent correction.
- **Nothing downstream can tell the difference.** A designed operation becomes
  an ordinary `ScenarioDefinition` and is fought by the same engine, the same
  enemy commander and the same battlefield tools. It is labelled as designed
  everywhere it is shown.
- **The engine now owns its operation.** `GameState` carries the whole
  definition instead of an id looked up in a shared table, and the enemy
  commander seats its guard from the objective rather than from a written group
  id. Two engines in one page — one authored, one designed — cannot read each
  other's script; the checksum test proves it.

# Verification

- New `tests/council.test.ts` covers the tool surface: registration and
  teardown, listing, battlefield description, a design that is accepted and then
  actually fought, a design that is refused with its table left untouched, and
  the closed council refusing every further call.
- `tests/scenarios.test.ts` fights all four authored operations and the designed
  one to a decision, lays the blank battle on every battlefield and checks every
  soldier of it stands on legal ground, and holds a designed battle beside an
  authored one without either bleeding into the other.
- Typecheck, the full node suite (196 tests across 14 files) and the production
  build pass. The suite's shared `testTimeout` moved from 60s to 150s: whole
  battles are now fought to a decision inside it, several at once on shared
  cores, and the real per-tick budget is still asserted by the performance test
  — 6.5 ms per 50 ms tick with 7,195 men on the field.
- The War Council and the handover were also driven in a real browser: the
  designed operation deploys, the roster shows the regiments the design named,
  and the battle runs with no console errors.

# Runtime Error Isolation

- Global browser error channels are now filtered by source ownership. Errors
  from `chrome-extension://`, `moz-extension://` and Safari extension scripts —
  including rejected MetaMask connections — remain visible in DevTools but no
  longer open Siege's fatal screen or stop its animation loop.
- Same-origin script errors and promise rejections whose stack identifies the
  Siege bundle still fail loudly. Direct bootstrap failures keep their explicit
  fatal handler, so filtering extensions does not hide a real startup fault.
- Four node regressions cover same-origin errors, extension errors, unattributed
  rejections and application-owned asynchronous failures.

# Smooth Combat Pass

- **Fair rounds.** Damage and siege splash accumulate in a reusable typed-array
  buffer and commit together after target resolution. Two troops landing lethal
  blows on the same tick can now kill one another; spawn order no longer grants
  one side a free unanswered attack.
- **Safe targets.** Combat and chase movement both require a stored target to be
  alive and hostile. This closes the free-list edge case where a dead enemy's
  index was recycled for a friendly reinforcement while another unit still held
  that index as its target.
- **Display-rate motion.** A render-only snapshot captures the state immediately
  before each fixed simulation step. Unit positions, regiment blobs and labels
  interpolate between snapshots, and arrows, sparks and siege impacts use a
  fractional visual age. Simulation state, checksums and command timing are not
  affected.
- **Verification.** Combat regression tests cover simultaneous lethal blows and
  recycled friendly targets. The combat suite, typecheck and production build
  pass; the 7,950-unit performance probe remains well inside budget at roughly
  7.5 ms per 50 ms simulation tick on this machine.

# Medieval Pixel-Art Pass

The whole command screen was redrawn as a single medieval pixel-art game. Every
mark on it — the ground, the woods, the keeps, the troop icons in the roster and
the glyphs on the command buttons — now comes out of one sprite vocabulary in
`rendering/canvas/pixelart.ts`, so the field and the interface cannot drift
apart. No simulation, command, query or WebMCP behaviour changed.

- **The ground is baked, not stroked.** `TerrainLayer` builds one 1334 × 834
  material bitmap per map — grass, tilled field, woodland floor, hillsides with
  contours, rock, river, bridge decking and worn tracks — resolves it to pixels
  through a two-tone dither, paints trees, cottages, halls, watchtowers, mine
  heads, waymarks and crags into it, and then draws it with a single
  nearest-neighbour `drawImage`. That replaces several hundred culled shape
  fills a frame, so the new look is also the cheaper one.
- **The map moves on the tick clock.** Water crests, torch flicker, chimney
  smoke and waving standards are drawn in world space from `currentTick`, never
  from wall-clock time, so the field freezes exactly when the battle is paused.
  Cosmetic scatter uses an index hash and never touches the simulation PRNG.
- **The minimap draws the same bitmap.** It is literally the same picture as the
  battlefield, reduced, with block markers, a pixel crown for each objective and
  a corner bracket for the camera. Several hundred lines of duplicated terrain
  drawing came out of `Minimap` with it.
- **Selection is gold and dithered.** A selected regiment gets a four-cornered
  gold bracket that breathes on the tick clock, a dithered gold field showing
  ten seconds of marching, and — for anything that shoots — a dithered crimson
  field at its true weapon range. Order paths are marching blocks and end in a
  gold pixel target.
- **A war journal, on parchment.** The right column is new: the minimap, then
  the selected regiment's strength, morale, vigour, orders, formation, stance,
  losses and known threats, then the ground under the cursor and what it is
  worth, then the objective. The terrain card that used to be drawn onto the
  battlefield, over the ground it described, is gone.
- **Real icons, no Unicode stand-ins.** Every glyph is emitted as crisp SVG
  rectangles from the same sprite sheet the map uses. The production headers
  allow no third-party font or image source, so the whole set ships inside the
  bundle. The one thing not converted is type: a hand-rolled bitmap face would
  have cost more legibility than it bought, so labels are a crisp monospace set
  in caps on a hard plate.
- **Place names survive the armies.** Zone labels are drawn between the troops
  and their labels: over a regiment's blocks, which used to erase the name of
  the ground it stood on, and under the regiment's own label.
- **It folds instead of refusing.** The old gate turned the game away below
  1100 px. The journal now lifts out of the grid and floats over the field at
  1180, the roster follows at 940, and only below 760 × 480 is the window
  genuinely too small to draw a battlefield in.

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

Across three seeds on Captain, the all-in rush now costs roughly two thirds of
the player's army and loses about as often as it wins, where before it won every
time with the army largely intact. `npm run test:balance` replays the rush
against a measured defence and prints both.

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
