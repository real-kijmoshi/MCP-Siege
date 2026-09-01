import { ZONE_IDS, type Front, type Vector2D, type ZoneId } from '../types/domain';

/**
 * The battlefields.
 *
 * A map is pure authored data: named ground, the graph that connects it, the
 * one barrier that makes the geography binding, and the colour of the earth.
 * Nothing here knows about the simulation — `simulation/Zones.ts` reads the map
 * a battle is being fought on and answers every geographic question from it.
 *
 * Every map is the same size, because the fog grid and the camera are sized
 * once in `config/battle.ts`. What differs is the shape of the ground, and that
 * is enough: a river with three bridges, a ridge with two gaps, an open plain
 * with nothing to hide behind, and a tidal channel crossed in two places play
 * as four different problems.
 */

export type TerrainKind =
  | 'open'
  | 'forest'
  | 'hill'
  | 'river'
  | 'village'
  | 'crossing'
  /** The impassable spine of a ridge map. Rock rather than water, but it divides alike. */
  | 'ridge';

export interface ZoneDefinition {
  id: ZoneId;
  name: string;
  center: Vector2D;
  radius: number;
  front: Front;
  terrain: TerrainKind;
  /** True for the few points where the barrier can be passed. */
  crossing: boolean;
  description: string;
}

/**
 * The single dividing feature of a map.
 *
 * Its centreline is `baseY + slope * x` plus a sum of sines, so a barrier can
 * run level or diagonally and never reads as a drawn straight line. It is
 * impassable everywhere except within the crossing zones, which is the whole
 * reason a bridge is worth dying on.
 */
export interface BarrierDefinition {
  kind: 'river' | 'ridge';
  name: string;
  baseY: number;
  slope: number;
  halfWidth: number;
  /** `[amplitude, wavelength]` pairs. */
  meander: ReadonlyArray<readonly [number, number]>;
}

/** Standing water away from the barrier: impassable, and no zone of its own. */
export interface MereDefinition {
  name: string;
  center: Vector2D;
  radius: number;
}

/**
 * Authored ground colouring, merged over the renderer's palette.
 *
 * Ash country is not the colour of harvest country, and telling one battlefield
 * from another at a glance is worth more than keeping every colour in one file.
 */
export interface GroundTint {
  grass?: string;
  openField?: string;
  hill?: string;
  hillContour?: string;
  forestCanopy?: string;
  village?: string;
  villageRoof?: string;
  road?: string;
  river?: string;
  riverEdge?: string;
  crossing?: string;
  crossingEdge?: string;
}

export const BATTLE_MAP_IDS = [
  'river_vale',
  'ashfall_pass',
  'goldmere',
  'sunken_causeway',
] as const;
export type BattleMapId = (typeof BATTLE_MAP_IDS)[number];

export interface BattleMapDefinition {
  id: BattleMapId;
  name: string;
  /** Shown on the War Council portrait. */
  caption: string;
  /** One line of geography for the briefing. */
  summary: string;
  /** The one tactical fact this ground imposes. */
  terrainNote: string;
  barrier?: BarrierDefinition;
  meres: readonly MereDefinition[];
  zones: readonly ZoneDefinition[];
  edges: ReadonlyArray<readonly [ZoneId, ZoneId]>;
  /** Drawn beneath everything, and a reading of where armies actually march. */
  roads: ReadonlyArray<readonly ZoneId[]>;
  playerHomeZone: ZoneId;
  enemyHomeZone: ZoneId;
  ground: GroundTint;
}

/* ----------------------------------------------------------- I. River Vale */

const RIVER_VALE: BattleMapDefinition = {
  id: 'river_vale',
  name: 'River Vale',
  caption: 'RIVER VALE · DAWN',
  summary: 'A slow river through open farmland, carrying three crossings.',
  terrainNote: 'The river is passable only at the three crossings.',
  barrier: {
    kind: 'river',
    name: 'The Vale Water',
    baseY: 2500,
    slope: 0,
    halfWidth: 135,
    meander: [
      [135, 1350],
      [32, 480],
    ],
  },
  meres: [],
  playerHomeZone: 'player_base',
  enemyHomeZone: 'enemy_base',
  ground: {},
  zones: [
    {
      id: 'player_base',
      name: 'Player Base',
      center: { x: 4000, y: 4550 },
      radius: 760,
      front: 'rear',
      terrain: 'open',
      crossing: false,
      description: 'Staging ground and muster point. Reinforcements arrive here.',
    },
    {
      id: 'west_forest',
      name: 'West Forest',
      center: { x: 1250, y: 3250 },
      radius: 660,
      front: 'west',
      terrain: 'forest',
      crossing: false,
      description: 'Dense woodland. Conceals movement toward the western ford.',
    },
    {
      id: 'west_crossing',
      name: 'West Crossing',
      center: { x: 1500, y: 2500 },
      radius: 380,
      front: 'west',
      terrain: 'crossing',
      crossing: true,
      description: 'A shallow ford. Narrow, and the only western route north.',
    },
    {
      id: 'village',
      name: 'Village',
      center: { x: 2750, y: 3550 },
      radius: 430,
      front: 'west',
      terrain: 'village',
      crossing: false,
      description: 'Abandoned village. Buildings break up cavalry charges.',
    },
    {
      id: 'central_field',
      name: 'Central Field',
      center: { x: 4000, y: 3200 },
      radius: 820,
      front: 'center',
      terrain: 'open',
      crossing: false,
      description: 'Open ground south of the bridge. The main line forms here.',
    },
    {
      id: 'central_bridge',
      name: 'Central Bridge',
      center: { x: 4000, y: 2500 },
      radius: 340,
      front: 'center',
      terrain: 'crossing',
      crossing: true,
      description: 'The main stone bridge. The decisive point of the battle.',
    },
    {
      id: 'central_hill',
      name: 'Central Hill',
      center: { x: 4950, y: 3050 },
      radius: 470,
      front: 'center',
      terrain: 'hill',
      crossing: false,
      description: 'High ground overlooking the bridge. Ideal for archers and siege.',
    },
    {
      id: 'east_field',
      name: 'East Field',
      center: { x: 6600, y: 3350 },
      radius: 780,
      front: 'east',
      terrain: 'open',
      crossing: false,
      description: 'Wide open ground. Excellent cavalry country, hard to hold.',
    },
    {
      id: 'east_crossing',
      name: 'East Crossing',
      center: { x: 6600, y: 2500 },
      radius: 360,
      front: 'east',
      terrain: 'crossing',
      crossing: true,
      description: 'A smaller bridge on the eastern flank.',
    },
    {
      id: 'east_forest',
      name: 'East Forest',
      center: { x: 7450, y: 3150 },
      radius: 570,
      front: 'east',
      terrain: 'forest',
      crossing: false,
      description: 'Woodland anchoring the eastern flank.',
    },
    {
      id: 'northern_ridge',
      name: 'Northern Ridge',
      center: { x: 2500, y: 1500 },
      radius: 720,
      front: 'west',
      terrain: 'hill',
      crossing: false,
      description: 'Enemy-held high ground north of the ford.',
    },
    {
      id: 'enemy_outer_defense',
      name: 'Enemy Outer Defense',
      center: { x: 4200, y: 1500 },
      radius: 860,
      front: 'center',
      terrain: 'open',
      crossing: false,
      description: 'Prepared enemy positions covering the northern bridgehead.',
    },
    {
      id: 'enemy_base',
      name: 'Enemy Base',
      center: { x: 4000, y: 620 },
      radius: 820,
      front: 'rear',
      terrain: 'open',
      crossing: false,
      description: 'Fortified enemy command position.',
    },
  ],
  edges: [
    ['player_base', 'central_field'],
    ['player_base', 'village'],
    ['player_base', 'east_field'],
    ['village', 'west_forest'],
    ['village', 'central_field'],
    ['west_forest', 'west_crossing'],
    ['central_field', 'central_bridge'],
    ['central_field', 'central_hill'],
    ['central_hill', 'east_field'],
    ['east_field', 'east_crossing'],
    ['east_field', 'east_forest'],
    ['east_forest', 'east_crossing'],
    // River crossings: the only edges that change bank.
    ['west_crossing', 'northern_ridge'],
    ['central_bridge', 'enemy_outer_defense'],
    ['east_crossing', 'enemy_outer_defense'],
    // Northern bank.
    ['northern_ridge', 'enemy_outer_defense'],
    ['northern_ridge', 'enemy_base'],
    ['enemy_outer_defense', 'enemy_base'],
  ],
  roads: [
    ['player_base', 'central_field', 'central_bridge', 'enemy_outer_defense', 'enemy_base'],
    ['player_base', 'village', 'west_forest', 'west_crossing', 'northern_ridge'],
    ['player_base', 'east_field', 'east_crossing', 'enemy_outer_defense'],
    ['village', 'central_field', 'central_hill', 'east_field'],
  ],
};

/* -------------------------------------------------------- II. Ashfall Pass */

const ASHFALL_PASS: BattleMapDefinition = {
  id: 'ashfall_pass',
  name: 'Ashfall Pass',
  caption: 'ASHFALL PASS · SMOKE',
  summary: 'A dead volcanic spine across the world, broken open in two places.',
  terrainNote: 'The spine cannot be crossed. Two gaps, and everything funnels into them.',
  barrier: {
    kind: 'ridge',
    name: 'The Ashfall Spine',
    baseY: 2450,
    slope: 0,
    halfWidth: 210,
    meander: [
      [170, 2600],
      [55, 820],
    ],
  },
  meres: [],
  playerHomeZone: 'crown_camp',
  enemyHomeZone: 'ash_citadel',
  ground: {
    grass: '#3d322a',
    openField: '#493b30',
    hill: '#564435',
    hillContour: '#806147',
    forestCanopy: '#344936',
    village: '#624c39',
    villageRoof: '#805f40',
    road: '#685943',
    river: '#382922',
    riverEdge: '#815b42',
    crossing: '#806647',
    crossingEdge: '#b08a58',
  },
  zones: [
    {
      id: 'crown_camp',
      name: 'Crown Camp',
      center: { x: 4000, y: 4500 },
      radius: 780,
      front: 'rear',
      terrain: 'open',
      crossing: false,
      description: 'The muster below the pass. Reinforcements arrive here.',
    },
    {
      id: 'south_orchard',
      name: 'South Orchard',
      center: { x: 2200, y: 3800 },
      radius: 620,
      front: 'west',
      terrain: 'forest',
      crossing: false,
      description: 'Ash-killed orchard below Cinder Gap. A column can form in it unseen.',
    },
    {
      id: 'smoke_road',
      name: 'Smoke Road',
      center: { x: 4000, y: 3700 },
      radius: 700,
      front: 'center',
      terrain: 'open',
      crossing: false,
      description: 'The graded road up to the gaps. Open, and watched from above.',
    },
    {
      id: 'slag_flats',
      name: 'Slag Flats',
      center: { x: 5950, y: 3900 },
      radius: 760,
      front: 'east',
      terrain: 'open',
      crossing: false,
      description: 'Flat waste below the gate. Fast to cross and impossible to hold.',
    },
    {
      id: 'broken_scree',
      name: 'Broken Scree',
      center: { x: 1150, y: 3150 },
      radius: 560,
      front: 'west',
      terrain: 'hill',
      crossing: false,
      description: 'Loose rock above the western approach. Hard ground to attack.',
    },
    {
      id: 'east_scarp',
      name: 'East Scarp',
      center: { x: 7100, y: 3200 },
      radius: 560,
      front: 'east',
      terrain: 'hill',
      crossing: false,
      description: 'A shelf overlooking the eastern gate. Siege country.',
    },
    {
      id: 'cinder_gap',
      name: 'Cinder Gap',
      center: { x: 2350, y: 2600 },
      radius: 520,
      front: 'west',
      terrain: 'crossing',
      crossing: true,
      description: 'A collapsed section of the spine. The western way through.',
    },
    {
      id: 'ashfall_gate',
      name: 'Ashfall Gate',
      center: { x: 5750, y: 2620 },
      radius: 500,
      front: 'east',
      terrain: 'crossing',
      crossing: true,
      description: 'The cut road through the spine. Narrow, and heavily watched.',
    },
    {
      id: 'upper_terrace',
      name: 'Upper Terrace',
      center: { x: 4000, y: 1950 },
      radius: 820,
      front: 'center',
      terrain: 'open',
      crossing: false,
      description: 'The shelf above both gaps. Whoever holds it holds the pass.',
    },
    {
      id: 'obsidian_wood',
      name: 'Obsidian Wood',
      center: { x: 2050, y: 1600 },
      radius: 620,
      front: 'west',
      terrain: 'forest',
      crossing: false,
      description: 'Black petrified timber north of Cinder Gap. Blind ground.',
    },
    {
      id: 'emberhold',
      name: 'Emberhold',
      center: { x: 6200, y: 1850 },
      radius: 470,
      front: 'east',
      terrain: 'village',
      crossing: false,
      description: 'A mining hold above the gate. Walls, and a view of the road.',
    },
    {
      id: 'smelters_hill',
      name: "Smelters' Hill",
      center: { x: 5200, y: 1250 },
      radius: 500,
      front: 'center',
      terrain: 'hill',
      crossing: false,
      description: 'Furnace hill covering the citadel from the east.',
    },
    {
      id: 'ash_citadel',
      name: 'Ash Citadel',
      center: { x: 4000, y: 700 },
      radius: 800,
      front: 'rear',
      terrain: 'open',
      crossing: false,
      description: 'The Ashen command seat, at the head of the pass.',
    },
  ],
  edges: [
    ['crown_camp', 'smoke_road'],
    ['crown_camp', 'south_orchard'],
    ['crown_camp', 'slag_flats'],
    ['south_orchard', 'broken_scree'],
    ['south_orchard', 'smoke_road'],
    ['smoke_road', 'slag_flats'],
    ['slag_flats', 'east_scarp'],
    // The two ways through the spine. A gap is only reachable from the ground
    // directly below and above it: a column approaching at an angle meets the
    // rock long before it meets the gap.
    ['south_orchard', 'cinder_gap'],
    ['cinder_gap', 'obsidian_wood'],
    ['slag_flats', 'ashfall_gate'],
    ['ashfall_gate', 'emberhold'],
    // Above the spine.
    ['obsidian_wood', 'upper_terrace'],
    ['upper_terrace', 'smelters_hill'],
    ['upper_terrace', 'emberhold'],
    ['smelters_hill', 'emberhold'],
    ['upper_terrace', 'ash_citadel'],
    ['obsidian_wood', 'ash_citadel'],
    ['smelters_hill', 'ash_citadel'],
  ],
  roads: [
    ['crown_camp', 'south_orchard', 'cinder_gap', 'obsidian_wood', 'ash_citadel'],
    ['crown_camp', 'slag_flats', 'ashfall_gate', 'emberhold', 'smelters_hill', 'ash_citadel'],
    ['south_orchard', 'smoke_road', 'slag_flats'],
    ['obsidian_wood', 'upper_terrace', 'emberhold'],
  ],
};

/* ------------------------------------------------------------ III. Goldmere */

const GOLDMERE: BattleMapDefinition = {
  id: 'goldmere',
  name: 'Goldmere',
  caption: 'GOLDMERE · HARVEST',
  summary: 'Harvest country. No river, no pass, and nowhere to hide an army.',
  terrainNote: 'Nothing divides this ground. Both flanks are open the whole way round.',
  meres: [
    { name: 'The Goldmere', center: { x: 2850, y: 2100 }, radius: 430 },
    { name: 'Crow Fen', center: { x: 5900, y: 2050 }, radius: 380 },
  ],
  playerHomeZone: 'harvest_camp',
  enemyHomeZone: 'ashen_camp',
  ground: {
    grass: '#3d4a28',
    openField: '#55602d',
    hill: '#5e6333',
    hillContour: '#858754',
    forestCanopy: '#315c2b',
    village: '#6d5a38',
    villageRoof: '#8b6b3f',
    road: '#6c6348',
  },
  zones: [
    {
      id: 'harvest_camp',
      name: 'Harvest Camp',
      center: { x: 4000, y: 4500 },
      radius: 780,
      front: 'rear',
      terrain: 'open',
      crossing: false,
      description: 'The southern muster among the ricks. Reinforcements arrive here.',
    },
    {
      id: 'millbrook',
      name: 'Millbrook',
      center: { x: 1900, y: 3950 },
      radius: 460,
      front: 'west',
      terrain: 'village',
      crossing: false,
      description: 'A mill village on the west road. Walls worth a regiment.',
    },
    {
      id: 'south_downs',
      name: 'South Downs',
      center: { x: 4200, y: 3750 },
      radius: 600,
      front: 'center',
      terrain: 'hill',
      crossing: false,
      description: 'Low rolling high ground. The only cover on the southern half.',
    },
    {
      id: 'hollow_wood',
      name: 'Hollow Wood',
      center: { x: 6500, y: 3900 },
      radius: 640,
      front: 'east',
      terrain: 'forest',
      crossing: false,
      description: 'Deep coppice on the eastern flank. A column can vanish in it.',
    },
    {
      id: 'west_pasture',
      name: 'West Pasture',
      center: { x: 1400, y: 2750 },
      radius: 720,
      front: 'west',
      terrain: 'open',
      crossing: false,
      description: 'Grazing land beyond the mere. Wide, and nothing stops a charge.',
    },
    {
      id: 'goldmere_town',
      name: 'Goldmere Town',
      center: { x: 4200, y: 2600 },
      radius: 560,
      front: 'center',
      terrain: 'village',
      crossing: false,
      description: 'The market town at the centre of the plain. The obvious anchor.',
    },
    {
      id: 'east_pasture',
      name: 'East Pasture',
      center: { x: 6700, y: 2700 },
      radius: 740,
      front: 'east',
      terrain: 'open',
      crossing: false,
      description: 'Open grazing east of the fen. The far end of any envelopment.',
    },
    {
      id: 'long_barrow',
      name: 'Long Barrow',
      center: { x: 5500, y: 3150 },
      radius: 480,
      front: 'center',
      terrain: 'hill',
      crossing: false,
      description: 'An old burial ridge between town and wood. Good archer ground.',
    },
    {
      id: 'crowsfoot_wood',
      name: 'Crowsfoot Wood',
      center: { x: 2400, y: 1700 },
      radius: 600,
      front: 'west',
      terrain: 'forest',
      crossing: false,
      description: 'Woodland on the enemy right. Cover for a wide flanking march.',
    },
    {
      id: 'beacon_hill',
      name: 'Beacon Hill',
      center: { x: 4300, y: 1600 },
      radius: 620,
      front: 'center',
      terrain: 'hill',
      crossing: false,
      description: 'The high ground the Ashen army forms on. It sees the whole plain.',
    },
    {
      id: 'hartfell',
      name: 'Hartfell',
      center: { x: 6400, y: 1550 },
      radius: 620,
      front: 'east',
      terrain: 'open',
      crossing: false,
      description: 'Open upland on the enemy left. Their cavalry masses here.',
    },
    {
      id: 'stone_row',
      name: 'Stone Row',
      center: { x: 2100, y: 950 },
      radius: 520,
      front: 'west',
      terrain: 'open',
      crossing: false,
      description: 'Standing stones behind the enemy right. A road to their rear.',
    },
    {
      id: 'ashen_camp',
      name: 'Ashen Camp',
      center: { x: 4000, y: 700 },
      radius: 800,
      front: 'rear',
      terrain: 'open',
      crossing: false,
      description: 'The Ashen encampment at the head of the plain.',
    },
  ],
  edges: [
    ['harvest_camp', 'south_downs'],
    ['harvest_camp', 'millbrook'],
    ['harvest_camp', 'hollow_wood'],
    ['millbrook', 'west_pasture'],
    ['millbrook', 'south_downs'],
    ['south_downs', 'goldmere_town'],
    ['south_downs', 'long_barrow'],
    ['south_downs', 'hollow_wood'],
    ['hollow_wood', 'long_barrow'],
    ['hollow_wood', 'east_pasture'],
    ['long_barrow', 'east_pasture'],
    ['long_barrow', 'goldmere_town'],
    ['west_pasture', 'goldmere_town'],
    ['west_pasture', 'crowsfoot_wood'],
    ['goldmere_town', 'beacon_hill'],
    ['goldmere_town', 'east_pasture'],
    ['east_pasture', 'hartfell'],
    ['crowsfoot_wood', 'beacon_hill'],
    ['crowsfoot_wood', 'stone_row'],
    ['beacon_hill', 'hartfell'],
    ['beacon_hill', 'stone_row'],
    ['beacon_hill', 'ashen_camp'],
    ['hartfell', 'ashen_camp'],
    ['stone_row', 'ashen_camp'],
  ],
  roads: [
    ['harvest_camp', 'south_downs', 'goldmere_town', 'beacon_hill', 'ashen_camp'],
    ['harvest_camp', 'millbrook', 'west_pasture', 'crowsfoot_wood', 'stone_row'],
    ['harvest_camp', 'hollow_wood', 'east_pasture', 'hartfell', 'ashen_camp'],
    ['millbrook', 'south_downs', 'long_barrow', 'east_pasture'],
  ],
};

/* ------------------------------------------------------ IV. Sunken Causeway */

const SUNKEN_CAUSEWAY: BattleMapDefinition = {
  id: 'sunken_causeway',
  name: 'Sunken Causeway',
  caption: 'THE SUNKEN COAST · TIDE',
  summary: 'A tidal channel cut diagonally across the coast, crossed in two places.',
  terrainNote: 'The channel runs corner to corner. One causeway, one ford, nothing else.',
  barrier: {
    kind: 'river',
    name: 'The Drowned Channel',
    baseY: 3100,
    slope: -0.14,
    halfWidth: 210,
    meander: [
      [120, 1700],
      [40, 560],
    ],
  },
  meres: [],
  playerHomeZone: 'tidewatch',
  enemyHomeZone: 'ashen_anchorage',
  ground: {
    grass: '#2d4941',
    openField: '#3a574d',
    hill: '#465d4a',
    hillContour: '#66806b',
    forestCanopy: '#285a43',
    village: '#665d49',
    villageRoof: '#877557',
    road: '#5c6054',
    river: '#174358',
    riverEdge: '#347b91',
  },
  zones: [
    {
      id: 'tidewatch',
      name: 'Tidewatch',
      center: { x: 2900, y: 4400 },
      radius: 780,
      front: 'rear',
      terrain: 'open',
      crossing: false,
      description: 'The Crown landing on the near shore. Reinforcements arrive here.',
    },
    {
      id: 'drowned_wood',
      name: 'Drowned Wood',
      center: { x: 1300, y: 3900 },
      radius: 620,
      front: 'west',
      terrain: 'forest',
      crossing: false,
      description: 'Salt-killed woodland on the western shore. Blind and slow.',
    },
    {
      id: 'causeway_approach',
      name: 'Causeway Approach',
      center: { x: 3300, y: 3550 },
      radius: 640,
      front: 'center',
      terrain: 'open',
      crossing: false,
      description: 'The staging ground before the causeway. Everything forms here.',
    },
    {
      id: 'reed_flats',
      name: 'Reed Flats',
      center: { x: 5000, y: 3050 },
      radius: 600,
      front: 'center',
      terrain: 'open',
      crossing: false,
      description: 'Reed beds between causeway and ford. Wet, slow, and exposed.',
    },
    {
      id: 'oyster_town',
      name: 'Oyster Town',
      center: { x: 5100, y: 3900 },
      radius: 470,
      front: 'east',
      terrain: 'village',
      crossing: false,
      description: 'A fishing town on the near shore. Stone houses, narrow lanes.',
    },
    {
      id: 'gull_hill',
      name: 'Gull Hill',
      center: { x: 6600, y: 3450 },
      radius: 540,
      front: 'east',
      terrain: 'hill',
      crossing: false,
      description: 'A headland above the ford. It sees every boat and every column.',
    },
    {
      id: 'long_causeway',
      name: 'Long Causeway',
      center: { x: 3050, y: 2760 },
      radius: 400,
      front: 'center',
      terrain: 'crossing',
      crossing: true,
      description: 'A raised stone road across the channel. Long, and utterly exposed.',
    },
    {
      id: 'salt_ford',
      name: 'Salt Ford',
      center: { x: 6300, y: 2120 },
      radius: 340,
      front: 'east',
      terrain: 'crossing',
      crossing: true,
      description: 'A tidal ford on the eastern reach. Passable, and only just.',
    },
    {
      id: 'north_strand',
      name: 'North Strand',
      center: { x: 2400, y: 1950 },
      radius: 700,
      front: 'west',
      terrain: 'open',
      crossing: false,
      description: 'The far shore beyond the causeway. Open sand and dune grass.',
    },
    {
      id: 'black_pines',
      name: 'Black Pines',
      center: { x: 1200, y: 1250 },
      radius: 580,
      front: 'west',
      terrain: 'forest',
      crossing: false,
      description: 'Pine forest on the enemy right. It hides a whole wing.',
    },
    {
      id: 'beacon_tower',
      name: 'Beacon Tower',
      center: { x: 4200, y: 1900 },
      radius: 520,
      front: 'center',
      terrain: 'hill',
      crossing: false,
      description: 'A signal tower on the height between both crossings.',
    },
    {
      id: 'herring_quay',
      name: 'Herring Quay',
      center: { x: 6900, y: 1450 },
      radius: 460,
      front: 'east',
      terrain: 'village',
      crossing: false,
      description: 'The Ashen supply quay above the ford. Their road east.',
    },
    {
      id: 'ashen_anchorage',
      name: 'Ashen Anchorage',
      center: { x: 5600, y: 800 },
      radius: 800,
      front: 'rear',
      terrain: 'open',
      crossing: false,
      description: 'The Ashen camp above the anchorage. Their command seat.',
    },
  ],
  edges: [
    ['tidewatch', 'causeway_approach'],
    ['tidewatch', 'drowned_wood'],
    ['tidewatch', 'oyster_town'],
    ['drowned_wood', 'causeway_approach'],
    ['drowned_wood', 'long_causeway'],
    ['causeway_approach', 'reed_flats'],
    ['causeway_approach', 'long_causeway'],
    ['reed_flats', 'oyster_town'],
    ['reed_flats', 'salt_ford'],
    ['oyster_town', 'gull_hill'],
    ['gull_hill', 'salt_ford'],
    // The two ways over the channel.
    ['long_causeway', 'north_strand'],
    ['long_causeway', 'beacon_tower'],
    ['salt_ford', 'beacon_tower'],
    ['salt_ford', 'herring_quay'],
    // The far shore.
    ['north_strand', 'black_pines'],
    ['north_strand', 'beacon_tower'],
    ['black_pines', 'ashen_anchorage'],
    ['beacon_tower', 'herring_quay'],
    ['beacon_tower', 'ashen_anchorage'],
    ['herring_quay', 'ashen_anchorage'],
  ],
  roads: [
    ['tidewatch', 'causeway_approach', 'long_causeway', 'beacon_tower', 'ashen_anchorage'],
    ['tidewatch', 'oyster_town', 'reed_flats', 'salt_ford', 'herring_quay', 'ashen_anchorage'],
    ['drowned_wood', 'causeway_approach', 'reed_flats', 'gull_hill'],
    ['north_strand', 'black_pines'],
    ['north_strand', 'beacon_tower'],
  ],
};

/* ---------------------------------------------------------------- registry */

export const BATTLE_MAPS: Record<BattleMapId, BattleMapDefinition> = {
  river_vale: RIVER_VALE,
  ashfall_pass: ASHFALL_PASS,
  goldmere: GOLDMERE,
  sunken_causeway: SUNKEN_CAUSEWAY,
};

/**
 * Every zone on every map, by id.
 *
 * A zone id belongs to exactly one map, so a name is never ambiguous and a
 * report can resolve a location without first knowing which battle it came
 * from. The claim is checked rather than trusted: a duplicated or an unclaimed
 * id is an authoring mistake that would otherwise surface as a regiment
 * standing somewhere that does not exist.
 */
export const ZONE_CATALOGUE: Record<ZoneId, ZoneDefinition> = (() => {
  const catalogue = {} as Record<ZoneId, ZoneDefinition>;
  const owner = new Map<ZoneId, BattleMapId>();

  for (const mapId of BATTLE_MAP_IDS) {
    for (const zone of BATTLE_MAPS[mapId].zones) {
      const claimed = owner.get(zone.id);
      if (claimed !== undefined) {
        throw new Error(`Zone "${zone.id}" is claimed by both ${claimed} and ${mapId}.`);
      }
      owner.set(zone.id, mapId);
      catalogue[zone.id] = zone;
    }
  }

  for (const id of ZONE_IDS) {
    if (!owner.has(id)) throw new Error(`Zone "${id}" belongs to no map.`);
  }
  return catalogue;
})();

/** Which map a named location belongs to. */
export const ZONE_MAP_ID: Record<ZoneId, BattleMapId> = (() => {
  const byZone = {} as Record<ZoneId, BattleMapId>;
  for (const mapId of BATTLE_MAP_IDS) {
    for (const zone of BATTLE_MAPS[mapId].zones) byZone[zone.id] = mapId;
  }
  return byZone;
})();

export function getBattleMap(id: BattleMapId): BattleMapDefinition {
  return BATTLE_MAPS[id];
}

/** The centreline of a map's barrier at a given x. */
export function barrierCenterY(barrier: BarrierDefinition, x: number): number {
  let y = barrier.baseY + barrier.slope * x;
  for (const [amplitude, wavelength] of barrier.meander) y += Math.sin(x / wavelength) * amplitude;
  return y;
}
