import { fillFormationSlots } from '../simulation/Formations';
import { findGroup, registerGroup, type GameState } from '../simulation/GameState';
import {
  activeBattleMap,
  barrierCenterAt,
  isPassable,
  useBattleMap,
  zoneAt,
} from '../simulation/Zones';
import { type BattleMapId } from './maps';
import {
  type ScenarioId,
  type ScriptedAiOrder,
} from './matches';
import {
  factionOf,
  type ArmyGroup,
  type Formation,
  type PlayerId,
  type Stance,
  type UnitCategory,
  type Vector2D,
  type ZoneId,
} from '../types/domain';

/**
 * Authored battle scenarios.
 *
 * A scenario is a map, a deployment on it, and a written enemy script. The two
 * armies are always the same twenty regiments, so `redeploy` restates only what
 * a given operation changes — where a regiment stands, how it is drawn up, and
 * occasionally what it is made of. That keeps every group id stable across
 * every battlefield, which is what lets one WebMCP tool surface and one enemy
 * commander serve all of them.
 *
 * Openings are quiet enough to command by hand, and each escalation timeline
 * deliberately overloads a single human a few minutes in — which is the moment
 * the Marshal earns its place.
 */

export interface GroupSpec {
  id: string;
  name: string;
  ownerId: PlayerId;
  anchor: Vector2D;
  formation: Formation;
  stance: Stance;
  composition: ReadonlyArray<readonly [UnitCategory, number]>;
}

/** North is negative Y, so the player looks up the map and the enemy looks down. */
const FACING_NORTH = -Math.PI / 2;
const FACING_SOUTH = Math.PI / 2;

export const PLAYER_GROUPS: readonly GroupSpec[] = [
  {
    id: 'legion_i',
    name: 'Legion I',
    ownerId: 'player',
    anchor: { x: 3480, y: 3150 },
    formation: 'line',
    stance: 'defensive',
    composition: [['infantry', 640], ['heavy_infantry', 260]],
  },
  {
    id: 'legion_ii',
    name: 'Legion II',
    ownerId: 'player',
    anchor: { x: 4520, y: 3180 },
    formation: 'line',
    stance: 'defensive',
    composition: [['infantry', 560], ['heavy_infantry', 140]],
  },
  {
    id: 'spearwall',
    name: 'Spearwall',
    ownerId: 'player',
    anchor: { x: 4000, y: 2930 },
    formation: 'double_line',
    stance: 'hold_ground',
    composition: [['spearman', 400]],
  },
  {
    id: 'archers_i',
    name: 'Archers I',
    ownerId: 'player',
    anchor: { x: 4000, y: 3560 },
    formation: 'double_line',
    stance: 'defensive',
    composition: [['archer', 450]],
  },
  {
    id: 'cavalry_i',
    name: 'Cavalry I',
    ownerId: 'player',
    anchor: { x: 1950, y: 3320 },
    formation: 'wedge',
    stance: 'aggressive',
    composition: [['cavalry', 260]],
  },
  {
    id: 'cavalry_ii',
    name: 'Cavalry II',
    ownerId: 'player',
    anchor: { x: 6480, y: 3320 },
    formation: 'wedge',
    stance: 'aggressive',
    composition: [['cavalry', 180]],
  },
  {
    id: 'siege_corps',
    name: 'Siege Corps',
    ownerId: 'player',
    anchor: { x: 4950, y: 3060 },
    formation: 'loose',
    stance: 'hold_ground',
    composition: [['siege', 40]],
  },
  {
    id: 'arquebusiers',
    name: 'Arquebusiers',
    ownerId: 'player',
    anchor: { x: 4560, y: 3420 },
    formation: 'double_line',
    stance: 'defensive',
    composition: [['handgunner', 260]],
  },
  {
    id: 'culverins',
    name: 'Culverin Battery',
    ownerId: 'player',
    anchor: { x: 3450, y: 3600 },
    formation: 'loose',
    stance: 'hold_ground',
    composition: [['cannon', 26]],
  },
  {
    id: 'field_hospital',
    name: 'Field Hospital',
    ownerId: 'player',
    anchor: { x: 3600, y: 4650 },
    formation: 'loose',
    stance: 'hold_ground',
    composition: [['surgeon', 70]],
  },
  {
    id: 'scouts',
    name: 'Scouts',
    ownerId: 'player',
    anchor: { x: 5700, y: 3250 },
    formation: 'loose',
    stance: 'defensive',
    composition: [['scout', 40]],
  },
  {
    id: 'reserve_i',
    name: 'Reserve I',
    ownerId: 'player',
    anchor: { x: 4000, y: 4420 },
    formation: 'block',
    stance: 'defensive',
    composition: [['infantry', 400], ['spearman', 120], ['archer', 80]],
  },
  {
    id: 'royal_guard',
    name: 'Royal Guard',
    ownerId: 'player',
    anchor: { x: 4000, y: 4620 },
    formation: 'square',
    stance: 'hold_ground',
    composition: [['heavy_infantry', 260], ['spearman', 120]],
  },
];

export const ENEMY_GROUPS: readonly GroupSpec[] = [
  {
    id: 'iron_host',
    name: 'Iron Host',
    ownerId: 'enemy',
    anchor: { x: 3780, y: 1660 },
    formation: 'line',
    stance: 'defensive',
    composition: [['infantry', 700], ['heavy_infantry', 250]],
  },
  {
    id: 'ash_legion',
    name: 'Ash Legion',
    ownerId: 'enemy',
    anchor: { x: 4680, y: 1660 },
    formation: 'line',
    stance: 'defensive',
    composition: [['infantry', 700]],
  },
  {
    id: 'northern_spears',
    name: 'Northern Spears',
    ownerId: 'enemy',
    anchor: { x: 4200, y: 1960 },
    formation: 'double_line',
    stance: 'hold_ground',
    composition: [['spearman', 380]],
  },
  {
    id: 'black_arrows',
    name: 'Black Arrows',
    ownerId: 'enemy',
    anchor: { x: 4200, y: 1230 },
    formation: 'double_line',
    stance: 'defensive',
    composition: [['archer', 480]],
  },
  {
    id: 'storm_riders',
    name: 'Storm Riders',
    ownerId: 'enemy',
    anchor: { x: 2480, y: 1520 },
    formation: 'wedge',
    stance: 'aggressive',
    composition: [['cavalry', 300]],
  },
  {
    id: 'night_riders',
    name: 'Night Riders',
    ownerId: 'enemy',
    anchor: { x: 6350, y: 1780 },
    formation: 'wedge',
    stance: 'aggressive',
    composition: [['cavalry', 220]],
  },
  {
    id: 'siege_train',
    name: 'Siege Train',
    ownerId: 'enemy',
    anchor: { x: 4000, y: 940 },
    formation: 'loose',
    stance: 'hold_ground',
    composition: [['siege', 45]],
  },
  {
    id: 'ash_shot',
    name: 'Ashen Shot',
    ownerId: 'enemy',
    anchor: { x: 3700, y: 1420 },
    formation: 'double_line',
    stance: 'defensive',
    composition: [['handgunner', 280]],
  },
  {
    id: 'black_guns',
    name: 'Black Guns',
    ownerId: 'enemy',
    anchor: { x: 4450, y: 1050 },
    formation: 'loose',
    stance: 'hold_ground',
    composition: [['cannon', 28]],
  },
  {
    id: 'ashen_surgeons',
    name: 'Ashen Surgeons',
    ownerId: 'enemy',
    anchor: { x: 4400, y: 640 },
    formation: 'loose',
    stance: 'hold_ground',
    composition: [['surgeon', 70]],
  },
  {
    id: 'outriders',
    name: 'Outriders',
    ownerId: 'enemy',
    anchor: { x: 5400, y: 1620 },
    formation: 'loose',
    stance: 'defensive',
    composition: [['scout', 45]],
  },
  {
    id: 'ashen_reserve',
    name: 'Ashen Reserve',
    ownerId: 'enemy',
    anchor: { x: 4000, y: 840 },
    formation: 'block',
    stance: 'defensive',
    composition: [['infantry', 380], ['spearman', 120]],
  },
  {
    id: 'ashen_guard',
    name: 'Ashen Guard',
    ownerId: 'enemy',
    anchor: { x: 4000, y: 560 },
    formation: 'square',
    stance: 'hold_ground',
    composition: [['heavy_infantry', 260], ['spearman', 120]],
  },
];

/**
 * The two sovereigns.
 *
 * Each rides with the guard named here, which is the only reason a king is ever
 * reachable: to take one you must first break or draw off the regiment around
 * him. Neither king is a unit — see `simulation/Objective.ts`.
 */
export interface KingSpec {
  ownerId: PlayerId;
  name: string;
  guardGroupId: string;
}

export const KING_SPECS: readonly KingSpec[] = [
  { ownerId: 'player', name: 'King Aldric', guardGroupId: 'royal_guard' },
  { ownerId: 'enemy', name: 'The Ashen King', guardGroupId: 'ashen_guard' },
];

export interface ScenarioDefinition {
  id: ScenarioId;
  /** The ground it is fought on. Deployments are in that map's coordinates. */
  mapId: BattleMapId;
  eyebrow: string;
  name: string;
  description: string;
  objective: string;
  pressure: string;
  duration: string;
  tags: readonly string[];
  location: string;
  briefingLine: string;
  battleOrders: readonly [string, string];
  battleFacts: readonly [string, string, string];
  playerArmyName: string;
  enemyArmyName: string;
  playerGroups: readonly GroupSpec[];
  enemyGroups: readonly GroupSpec[];
  kingSpecs: readonly KingSpec[];
  aiScript: readonly ScriptedAiOrder[];
}

type GroupChanges = Partial<
  Record<
    string,
    Partial<Pick<GroupSpec, 'anchor' | 'formation' | 'stance' | 'composition'>>
  >
>;

function redeploy(groups: readonly GroupSpec[], changes: GroupChanges): GroupSpec[] {
  return groups.map((group) => ({ ...group, ...changes[group.id] }));
}

const RIVERWATCH_SCRIPT: readonly ScriptedAiOrder[] = [
  { atSeconds: 18, groupId: 'iron_host', order: 'attack_zone', targetZone: 'central_bridge', formation: 'column' },
  { atSeconds: 22, groupId: 'ash_legion', order: 'attack_zone', targetZone: 'central_bridge', formation: 'column' },
  { atSeconds: 28, groupId: 'northern_spears', order: 'attack_zone', targetZone: 'central_bridge', formation: 'column' },
  { atSeconds: 34, groupId: 'black_arrows', order: 'move', targetZone: 'central_bridge', formation: 'column' },
  { atSeconds: 46, groupId: 'black_guns', order: 'attack_zone', targetZone: 'central_bridge', formation: 'loose', stance: 'hold_ground' },
  { atSeconds: 58, groupId: 'ash_shot', order: 'attack_zone', targetZone: 'central_bridge', formation: 'column' },
  { atSeconds: 78, groupId: 'ashen_surgeons', order: 'move', targetZone: 'enemy_outer_defense', formation: 'loose' },
  { atSeconds: 85, groupId: 'iron_host', order: 'attack_zone', targetZone: 'central_field', formation: 'line' },
  { atSeconds: 92, groupId: 'ash_legion', order: 'attack_zone', targetZone: 'central_field', formation: 'line' },
  { atSeconds: 100, groupId: 'northern_spears', order: 'attack_zone', targetZone: 'central_field', formation: 'double_line' },
  { atSeconds: 115, groupId: 'night_riders', order: 'attack_zone', targetZone: 'east_crossing', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 150, groupId: 'night_riders', order: 'attack_zone', targetZone: 'east_field', formation: 'wedge' },
  { atSeconds: 175, groupId: 'storm_riders', order: 'attack_zone', targetZone: 'west_crossing', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 235, groupId: 'siege_train', order: 'attack_zone', targetZone: 'central_bridge', formation: 'loose', stance: 'hold_ground' },
  { atSeconds: 250, groupId: 'ashen_reserve', order: 'move', targetZone: 'enemy_outer_defense' },
  { atSeconds: 300, groupId: 'storm_riders', order: 'attack_zone', targetZone: 'central_field', formation: 'wedge' },
  { atSeconds: 340, groupId: 'ashen_reserve', order: 'attack_zone', targetZone: 'central_bridge' },
  { atSeconds: 400, groupId: 'night_riders', order: 'attack_zone', targetZone: 'player_base', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 460, groupId: 'ash_legion', order: 'attack_zone', targetZone: 'player_base', formation: 'column' },
];

const BRIDGEHEAD_PLAYER = redeploy(PLAYER_GROUPS, {
  // The shot crosses with the vanguard; the guns and the surgeons do not. A
  // hospital on the wrong bank means every wounded regiment has to come back
  // over the bridge the whole operation depends on keeping open.
  arquebusiers: { anchor: { x: 4350, y: 1950 }, stance: 'aggressive' },
  culverins: { anchor: { x: 4750, y: 2250 } },
  field_hospital: { anchor: { x: 4000, y: 3450 } },
  legion_i: { anchor: { x: 3450, y: 2050 }, stance: 'aggressive' },
  legion_ii: { anchor: { x: 4650, y: 2080 }, stance: 'aggressive' },
  spearwall: { anchor: { x: 4020, y: 2280 }, formation: 'line' },
  archers_i: { anchor: { x: 4050, y: 1810 } },
  cavalry_i: { anchor: { x: 2100, y: 2250 } },
  cavalry_ii: { anchor: { x: 6200, y: 2200 } },
  siege_corps: { anchor: { x: 5100, y: 2020 } },
  scouts: { anchor: { x: 5850, y: 1900 } },
  reserve_i: { anchor: { x: 4000, y: 3400 } },
});

const BRIDGEHEAD_ENEMY = redeploy(ENEMY_GROUPS, {
  ash_shot: { anchor: { x: 4450, y: 1100 } },
  black_guns: { anchor: { x: 3800, y: 800 } },
  ashen_surgeons: { anchor: { x: 4300, y: 620 } },
  iron_host: { anchor: { x: 3400, y: 1220 }, stance: 'aggressive' },
  ash_legion: { anchor: { x: 4800, y: 1240 }, stance: 'aggressive' },
  northern_spears: { anchor: { x: 4100, y: 1480 } },
  black_arrows: { anchor: { x: 4100, y: 900 } },
  storm_riders: { anchor: { x: 1900, y: 1450 } },
  night_riders: { anchor: { x: 6500, y: 1500 } },
});

const BRIDGEHEAD_SCRIPT: readonly ScriptedAiOrder[] = [
  { atSeconds: 18, groupId: 'iron_host', order: 'attack_zone', targetZone: 'central_bridge', formation: 'line', stance: 'aggressive' },
  { atSeconds: 24, groupId: 'ash_legion', order: 'attack_zone', targetZone: 'central_bridge', formation: 'line', stance: 'aggressive' },
  { atSeconds: 32, groupId: 'northern_spears', order: 'defend_zone', targetZone: 'enemy_outer_defense', formation: 'double_line' },
  { atSeconds: 42, groupId: 'black_arrows', order: 'attack_zone', targetZone: 'central_bridge', formation: 'loose' },
  { atSeconds: 52, groupId: 'black_guns', order: 'attack_zone', targetZone: 'central_bridge', formation: 'loose', stance: 'hold_ground' },
  { atSeconds: 58, groupId: 'ash_shot', order: 'attack_zone', targetZone: 'enemy_outer_defense', formation: 'double_line' },
  { atSeconds: 65, groupId: 'storm_riders', order: 'attack_zone', targetZone: 'west_crossing', formation: 'wedge' },
  { atSeconds: 72, groupId: 'night_riders', order: 'attack_zone', targetZone: 'east_crossing', formation: 'wedge' },
  { atSeconds: 115, groupId: 'ashen_reserve', order: 'attack_zone', targetZone: 'enemy_outer_defense', formation: 'line' },
  { atSeconds: 150, groupId: 'siege_train', order: 'attack_zone', targetZone: 'central_bridge', formation: 'loose' },
  { atSeconds: 210, groupId: 'storm_riders', order: 'attack_zone', targetZone: 'player_base', formation: 'wedge' },
  { atSeconds: 260, groupId: 'ash_legion', order: 'attack_zone', targetZone: 'player_base', formation: 'column' },
];

const LAST_LIGHT_PLAYER = redeploy(PLAYER_GROUPS, {
  arquebusiers: { anchor: { x: 4550, y: 3950 } },
  culverins: { anchor: { x: 3500, y: 4350 } },
  field_hospital: { anchor: { x: 4000, y: 4700 } },
  legion_i: { anchor: { x: 3050, y: 3850 }, formation: 'double_line' },
  legion_ii: { anchor: { x: 5000, y: 3850 }, formation: 'double_line' },
  spearwall: { anchor: { x: 4000, y: 3550 }, formation: 'square' },
  archers_i: { anchor: { x: 4050, y: 4050 }, formation: 'loose' },
  cavalry_i: { anchor: { x: 2450, y: 4100 } },
  cavalry_ii: { anchor: { x: 5650, y: 4100 } },
  siege_corps: { anchor: { x: 5050, y: 4300 } },
  scouts: { anchor: { x: 6500, y: 3850 } },
  reserve_i: { anchor: { x: 3150, y: 4500 }, formation: 'square' },
});

const LAST_LIGHT_ENEMY = redeploy(ENEMY_GROUPS, {
  ash_shot: { anchor: { x: 4600, y: 2750 } },
  black_guns: { anchor: { x: 4500, y: 2300 } },
  ashen_surgeons: { anchor: { x: 3600, y: 1850 } },
  iron_host: { anchor: { x: 3450, y: 2850 }, stance: 'aggressive' },
  ash_legion: { anchor: { x: 4700, y: 2900 }, stance: 'aggressive' },
  northern_spears: { anchor: { x: 4050, y: 3050 }, stance: 'aggressive' },
  black_arrows: { anchor: { x: 4050, y: 2550 }, formation: 'loose' },
  storm_riders: { anchor: { x: 2050, y: 3100 } },
  night_riders: { anchor: { x: 6100, y: 3100 } },
  siege_train: { anchor: { x: 5000, y: 2600 } },
  ashen_reserve: { anchor: { x: 4000, y: 2050 } },
});

/* ------------------------------------------------ IV. Ashfall Pass: assault */

/**
 * Cinder Road.
 *
 * The first battle fought somewhere other than the Vale. There is no line to
 * hold here: the spine cannot be crossed, so the whole army has to be fed into
 * two gaps four kilometres apart, and the commander's real decision is which
 * one he means and which one he is only pretending to mean. The siege train is
 * doubled, because the only way to soften a held gap is to shoot into it.
 */
const CINDER_ROAD_PLAYER = redeploy(PLAYER_GROUPS, {
  // One arm to each gap. Whichever the commander is only pretending to mean,
  // he has already committed a battery to it that cannot be recalled in time.
  arquebusiers: { anchor: { x: 5700, y: 3700 }, stance: 'aggressive' },
  culverins: { anchor: { x: 2600, y: 4100 } },
  field_hospital: { anchor: { x: 4000, y: 4400 } },
  legion_i: { anchor: { x: 2400, y: 3450 }, formation: 'column', stance: 'aggressive' },
  legion_ii: { anchor: { x: 5750, y: 3550 }, formation: 'column', stance: 'aggressive' },
  spearwall: { anchor: { x: 2300, y: 3850 }, formation: 'line' },
  archers_i: { anchor: { x: 2600, y: 3950 }, composition: [['archer', 470]] },
  cavalry_i: { anchor: { x: 1400, y: 3500 } },
  cavalry_ii: { anchor: { x: 6400, y: 3700 } },
  siege_corps: { anchor: { x: 5700, y: 3900 }, composition: [['siege', 48]] },
  scouts: { anchor: { x: 4000, y: 3400 } },
  reserve_i: { anchor: { x: 4000, y: 4300 } },
  // The Crown rides up the Smoke Road with the assault rather than waiting in
  // camp. Left at the muster he was simply unreachable — the spine protected
  // him better than his guard did, and the operation stopped being a battle
  // and became an arithmetic exercise the player could not lose.
  royal_guard: { anchor: { x: 4000, y: 3950 } },
});

const CINDER_ROAD_ENEMY = redeploy(ENEMY_GROUPS, {
  ash_shot: { anchor: { x: 5900, y: 2050 } },
  black_guns: { anchor: { x: 2400, y: 1600 } },
  ashen_surgeons: { anchor: { x: 4000, y: 1000 } },
  iron_host: {
    anchor: { x: 2400, y: 2050 },
    formation: 'double_line',
    stance: 'hold_ground',
    composition: [['infantry', 700], ['heavy_infantry', 350]],
  },
  ash_legion: { anchor: { x: 5750, y: 2150 }, formation: 'double_line', stance: 'hold_ground' },
  northern_spears: { anchor: { x: 2200, y: 1750 }, composition: [['spearman', 480]] },
  black_arrows: { anchor: { x: 5900, y: 1900 } },
  storm_riders: { anchor: { x: 3300, y: 1750 } },
  night_riders: { anchor: { x: 5000, y: 1600 } },
  siege_train: { anchor: { x: 4000, y: 1500 } },
  outriders: { anchor: { x: 4600, y: 2050 } },
  ashen_reserve: { anchor: { x: 4000, y: 1200 } },
  ashen_guard: { anchor: { x: 4000, y: 750 } },
});

/**
 * The Ashen commander does not stand in his own gaps.
 *
 * He tried it, and it was a massacre in the player's favour: a formation packed
 * into a defile is attacked from more quarters than it can face, and the
 * envelopment terms turn a held gap into a killing pen for its own garrison. He
 * holds the ground the gap debouches onto instead — the wood above Cinder Gap
 * and the walls of Emberhold above the Gate — so the assault has to come out of
 * the defile in a column and form up under fire.
 */
const CINDER_ROAD_SCRIPT: readonly ScriptedAiOrder[] = [
  { atSeconds: 12, groupId: 'iron_host', order: 'defend_zone', targetZone: 'obsidian_wood', formation: 'double_line', stance: 'hold_ground' },
  { atSeconds: 16, groupId: 'ash_legion', order: 'defend_zone', targetZone: 'emberhold', formation: 'double_line', stance: 'hold_ground' },
  { atSeconds: 26, groupId: 'black_arrows', order: 'defend_zone', targetZone: 'emberhold', formation: 'loose' },
  { atSeconds: 34, groupId: 'northern_spears', order: 'defend_zone', targetZone: 'obsidian_wood', formation: 'double_line' },
  { atSeconds: 40, groupId: 'night_riders', order: 'attack_zone', targetZone: 'slag_flats', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 55, groupId: 'storm_riders', order: 'defend_zone', targetZone: 'obsidian_wood', formation: 'wedge' },
  { atSeconds: 120, groupId: 'night_riders', order: 'defend_zone', targetZone: 'emberhold', formation: 'wedge' },
  { atSeconds: 70, groupId: 'black_guns', order: 'attack_zone', targetZone: 'cinder_gap', formation: 'loose', stance: 'hold_ground' },
  { atSeconds: 88, groupId: 'ash_shot', order: 'defend_zone', targetZone: 'emberhold', formation: 'double_line', stance: 'hold_ground' },
  { atSeconds: 100, groupId: 'siege_train', order: 'attack_zone', targetZone: 'ashfall_gate', formation: 'loose', stance: 'hold_ground' },
  { atSeconds: 130, groupId: 'ashen_reserve', order: 'move', targetZone: 'upper_terrace' },
  // Once the assault is committed in the defile, the horse goes into it.
  { atSeconds: 185, groupId: 'storm_riders', order: 'attack_zone', targetZone: 'cinder_gap', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 215, groupId: 'night_riders', order: 'attack_zone', targetZone: 'ashfall_gate', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 250, groupId: 'outriders', order: 'move', targetZone: 'obsidian_wood', formation: 'loose' },
  // The gate the player did not choose is a door that opens both ways.
  { atSeconds: 290, groupId: 'night_riders', order: 'attack_zone', targetZone: 'smoke_road', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 340, groupId: 'iron_host', order: 'attack_zone', targetZone: 'cinder_gap', formation: 'line', stance: 'aggressive' },
  { atSeconds: 400, groupId: 'ash_legion', order: 'attack_zone', targetZone: 'smoke_road', formation: 'column', stance: 'aggressive' },
  { atSeconds: 460, groupId: 'ashen_reserve', order: 'attack_zone', targetZone: 'cinder_gap', formation: 'column' },
];

/* -------------------------------------------- V. Ashfall Pass: the far side */

/**
 * The Ashen Gate.
 *
 * The gate has already been forced and the Crown itself is standing on the far
 * side of the spine, which means the road home is a single four-hundred-yard
 * gap the enemy only has to reach to close. Everything the player owns is north
 * of the rock except one relief column, and the cavalry is thin because horses
 * were the hardest thing to get through the gate.
 */
const ASHEN_GATE_PLAYER = redeploy(PLAYER_GROUPS, {
  arquebusiers: { anchor: { x: 6000, y: 2000 }, stance: 'aggressive' },
  culverins: { anchor: { x: 5900, y: 2400 } },
  field_hospital: { anchor: { x: 6350, y: 2300 } },
  legion_i: { anchor: { x: 5900, y: 2100 }, stance: 'aggressive' },
  legion_ii: { anchor: { x: 6250, y: 1900 }, stance: 'aggressive' },
  spearwall: { anchor: { x: 5750, y: 2300 }, formation: 'line' },
  archers_i: { anchor: { x: 6100, y: 2350 }, formation: 'loose' },
  cavalry_i: { anchor: { x: 5000, y: 2200 }, composition: [['cavalry', 200]] },
  cavalry_ii: { anchor: { x: 6800, y: 2200 }, composition: [['cavalry', 140]] },
  siege_corps: { anchor: { x: 5800, y: 2280 } },
  scouts: { anchor: { x: 4500, y: 2100 } },
  reserve_i: { anchor: { x: 5850, y: 2150 }, formation: 'square' },
  royal_guard: { anchor: { x: 6150, y: 1750 } },
});

const ASHEN_GATE_ENEMY = redeploy(ENEMY_GROUPS, {
  ash_shot: { anchor: { x: 4500, y: 1000 } },
  black_guns: { anchor: { x: 3700, y: 750 } },
  ashen_surgeons: { anchor: { x: 4400, y: 450 } },
  iron_host: { anchor: { x: 4000, y: 1250 }, stance: 'aggressive' },
  ash_legion: { anchor: { x: 4800, y: 1150 }, stance: 'aggressive' },
  northern_spears: { anchor: { x: 4300, y: 900 }, stance: 'aggressive' },
  black_arrows: { anchor: { x: 3600, y: 900 }, formation: 'loose' },
  storm_riders: { anchor: { x: 2600, y: 1500 } },
  night_riders: { anchor: { x: 5400, y: 1600 } },
  siege_train: { anchor: { x: 3900, y: 600 } },
  outriders: { anchor: { x: 3000, y: 1100 } },
  ashen_reserve: { anchor: { x: 4000, y: 400 } },
  ashen_guard: { anchor: { x: 4000, y: 750 } },
});

const ASHEN_GATE_SCRIPT: readonly ScriptedAiOrder[] = [
  { atSeconds: 10, groupId: 'iron_host', order: 'attack_zone', targetZone: 'emberhold', formation: 'line', stance: 'aggressive' },
  { atSeconds: 16, groupId: 'ash_legion', order: 'attack_zone', targetZone: 'emberhold', formation: 'line', stance: 'aggressive' },
  { atSeconds: 25, groupId: 'northern_spears', order: 'attack_zone', targetZone: 'upper_terrace', formation: 'double_line' },
  { atSeconds: 33, groupId: 'black_arrows', order: 'attack_zone', targetZone: 'upper_terrace', formation: 'loose' },
  { atSeconds: 48, groupId: 'night_riders', order: 'attack_zone', targetZone: 'ashfall_gate', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 75, groupId: 'storm_riders', order: 'attack_zone', targetZone: 'cinder_gap', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 40, groupId: 'ash_shot', order: 'attack_zone', targetZone: 'emberhold', formation: 'double_line', stance: 'aggressive' },
  { atSeconds: 96, groupId: 'black_guns', order: 'attack_zone', targetZone: 'upper_terrace', formation: 'loose', stance: 'hold_ground' },
  { atSeconds: 115, groupId: 'siege_train', order: 'attack_zone', targetZone: 'emberhold', formation: 'loose', stance: 'hold_ground' },
  { atSeconds: 150, groupId: 'ashen_reserve', order: 'attack_zone', targetZone: 'upper_terrace', formation: 'column' },
  { atSeconds: 205, groupId: 'storm_riders', order: 'attack_zone', targetZone: 'south_orchard', formation: 'wedge' },
  { atSeconds: 265, groupId: 'iron_host', order: 'attack_zone', targetZone: 'ashfall_gate', formation: 'column', stance: 'aggressive' },
];

/* ------------------------------------------------------ VI. Goldmere: open */

/**
 * Goldmere Fields.
 *
 * No river, no pass, no gate. Two armies form up in harvest country and there
 * is nothing on the map that stops either of them going round, which makes this
 * the one battle where the flanks are entirely the commander's problem. Both
 * sides are deliberately cavalry-heavy: the ground rewards the wide ride and
 * punishes a line that lets one develop.
 */
const GOLDMERE_PLAYER = redeploy(PLAYER_GROUPS, {
  // Open country is the one place a battery can see everything it wants to
  // shoot at, and the one place nothing stops horse getting behind it.
  arquebusiers: { anchor: { x: 4600, y: 3650 } },
  culverins: { anchor: { x: 3700, y: 4000 } },
  field_hospital: { anchor: { x: 4000, y: 4400 } },
  legion_i: { anchor: { x: 3300, y: 3450 }, composition: [['infantry', 560], ['heavy_infantry', 200]] },
  legion_ii: { anchor: { x: 4900, y: 3450 } },
  spearwall: { anchor: { x: 4100, y: 3250 } },
  archers_i: { anchor: { x: 4100, y: 3800 }, composition: [['archer', 420]] },
  cavalry_i: { anchor: { x: 1900, y: 3350 }, composition: [['cavalry', 340]] },
  cavalry_ii: { anchor: { x: 6300, y: 3400 }, composition: [['cavalry', 300]] },
  siege_corps: { anchor: { x: 4400, y: 3900 }, composition: [['siege', 30]] },
  scouts: { anchor: { x: 5600, y: 3500 }, composition: [['scout', 55]] },
  reserve_i: { anchor: { x: 4000, y: 4200 } },
  royal_guard: { anchor: { x: 4000, y: 4600 } },
});

const GOLDMERE_ENEMY = redeploy(ENEMY_GROUPS, {
  ash_shot: { anchor: { x: 4600, y: 1750 } },
  black_guns: { anchor: { x: 4000, y: 1300 } },
  ashen_surgeons: { anchor: { x: 4000, y: 900 } },
  iron_host: { anchor: { x: 3500, y: 2000 }, composition: [['infantry', 640], ['heavy_infantry', 240]] },
  ash_legion: { anchor: { x: 5000, y: 1950 }, composition: [['infantry', 680]] },
  northern_spears: { anchor: { x: 4250, y: 2250 }, composition: [['spearman', 400]] },
  black_arrows: { anchor: { x: 4300, y: 1500 }, composition: [['archer', 460]] },
  storm_riders: { anchor: { x: 2200, y: 2050 }, composition: [['cavalry', 360]] },
  night_riders: { anchor: { x: 6400, y: 1900 }, composition: [['cavalry', 300]] },
  siege_train: { anchor: { x: 4300, y: 1150 }, composition: [['siege', 30]] },
  outriders: { anchor: { x: 5400, y: 2350 }, composition: [['scout', 55]] },
  ashen_reserve: { anchor: { x: 4000, y: 1000 } },
  ashen_guard: { anchor: { x: 4000, y: 700 } },
});

const GOLDMERE_SCRIPT: readonly ScriptedAiOrder[] = [
  { atSeconds: 20, groupId: 'iron_host', order: 'attack_zone', targetZone: 'goldmere_town', formation: 'line', stance: 'aggressive' },
  { atSeconds: 26, groupId: 'ash_legion', order: 'attack_zone', targetZone: 'goldmere_town', formation: 'line', stance: 'aggressive' },
  { atSeconds: 35, groupId: 'northern_spears', order: 'attack_zone', targetZone: 'goldmere_town', formation: 'double_line' },
  { atSeconds: 43, groupId: 'black_arrows', order: 'move', targetZone: 'goldmere_town', formation: 'loose' },
  { atSeconds: 56, groupId: 'storm_riders', order: 'attack_zone', targetZone: 'west_pasture', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 64, groupId: 'night_riders', order: 'attack_zone', targetZone: 'east_pasture', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 112, groupId: 'storm_riders', order: 'attack_zone', targetZone: 'millbrook', formation: 'wedge' },
  { atSeconds: 128, groupId: 'night_riders', order: 'attack_zone', targetZone: 'hollow_wood', formation: 'wedge' },
  { atSeconds: 48, groupId: 'ash_shot', order: 'attack_zone', targetZone: 'goldmere_town', formation: 'double_line' },
  { atSeconds: 140, groupId: 'black_guns', order: 'attack_zone', targetZone: 'goldmere_town', formation: 'loose', stance: 'hold_ground' },
  { atSeconds: 168, groupId: 'siege_train', order: 'attack_zone', targetZone: 'goldmere_town', formation: 'loose', stance: 'hold_ground' },
  { atSeconds: 195, groupId: 'ashen_reserve', order: 'attack_zone', targetZone: 'south_downs', formation: 'column' },
  { atSeconds: 245, groupId: 'iron_host', order: 'attack_zone', targetZone: 'south_downs', formation: 'line' },
  { atSeconds: 305, groupId: 'storm_riders', order: 'attack_zone', targetZone: 'harvest_camp', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 365, groupId: 'ash_legion', order: 'attack_zone', targetZone: 'harvest_camp', formation: 'column' },
];

/* ------------------------------------------- VII. Sunken Causeway: the road */

/**
 * The Long Causeway.
 *
 * The channel runs corner to corner, so the two crossings are not a left and a
 * right but a near one and a far one, and a wing committed to the ford is a
 * long march from the wing on the causeway. Nothing else on any map punishes a
 * divided attack this plainly.
 */
const LONG_CAUSEWAY_PLAYER = redeploy(PLAYER_GROUPS, {
  arquebusiers: { anchor: { x: 5500, y: 3300 }, stance: 'aggressive' },
  culverins: { anchor: { x: 3400, y: 4150 } },
  field_hospital: { anchor: { x: 2900, y: 4400 } },
  legion_i: { anchor: { x: 3150, y: 3350 }, formation: 'column', stance: 'aggressive' },
  legion_ii: { anchor: { x: 5600, y: 3050 }, stance: 'aggressive' },
  spearwall: { anchor: { x: 3300, y: 3700 }, formation: 'line' },
  archers_i: { anchor: { x: 3350, y: 3900 } },
  cavalry_i: { anchor: { x: 1800, y: 3600 } },
  cavalry_ii: { anchor: { x: 6500, y: 3200 } },
  siege_corps: { anchor: { x: 3450, y: 3950 }, composition: [['siege', 60]] },
  scouts: { anchor: { x: 4300, y: 3400 } },
  reserve_i: { anchor: { x: 2900, y: 4200 } },
  royal_guard: { anchor: { x: 2900, y: 4500 } },
});

const LONG_CAUSEWAY_ENEMY = redeploy(ENEMY_GROUPS, {
  ash_shot: { anchor: { x: 3300, y: 1750 } },
  black_guns: { anchor: { x: 3800, y: 1400 } },
  ashen_surgeons: { anchor: { x: 5600, y: 950 } },
  iron_host: { anchor: { x: 3100, y: 2200 }, formation: 'double_line', stance: 'hold_ground' },
  ash_legion: { anchor: { x: 6250, y: 1700 }, formation: 'double_line', stance: 'hold_ground' },
  northern_spears: { anchor: { x: 2700, y: 1900 } },
  black_arrows: { anchor: { x: 3600, y: 1600 } },
  storm_riders: { anchor: { x: 1700, y: 1500 } },
  night_riders: { anchor: { x: 6800, y: 1250 } },
  siege_train: { anchor: { x: 4300, y: 1600 } },
  outriders: { anchor: { x: 5000, y: 1750 } },
  ashen_reserve: { anchor: { x: 5600, y: 1050 } },
  ashen_guard: { anchor: { x: 5600, y: 800 } },
});

const LONG_CAUSEWAY_SCRIPT: readonly ScriptedAiOrder[] = [
  { atSeconds: 15, groupId: 'iron_host', order: 'defend_zone', targetZone: 'long_causeway', formation: 'double_line', stance: 'hold_ground' },
  { atSeconds: 21, groupId: 'northern_spears', order: 'defend_zone', targetZone: 'long_causeway', formation: 'double_line' },
  { atSeconds: 29, groupId: 'black_arrows', order: 'defend_zone', targetZone: 'long_causeway', formation: 'loose' },
  { atSeconds: 42, groupId: 'ash_legion', order: 'defend_zone', targetZone: 'salt_ford', formation: 'double_line', stance: 'hold_ground' },
  { atSeconds: 72, groupId: 'night_riders', order: 'attack_zone', targetZone: 'salt_ford', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 104, groupId: 'storm_riders', order: 'defend_zone', targetZone: 'north_strand', formation: 'wedge' },
  { atSeconds: 36, groupId: 'ash_shot', order: 'defend_zone', targetZone: 'long_causeway', formation: 'double_line', stance: 'hold_ground' },
  { atSeconds: 118, groupId: 'black_guns', order: 'attack_zone', targetZone: 'long_causeway', formation: 'loose', stance: 'hold_ground' },
  { atSeconds: 145, groupId: 'siege_train', order: 'attack_zone', targetZone: 'long_causeway', formation: 'loose', stance: 'hold_ground' },
  { atSeconds: 180, groupId: 'outriders', order: 'move', targetZone: 'beacon_tower', formation: 'loose' },
  { atSeconds: 225, groupId: 'ashen_reserve', order: 'move', targetZone: 'beacon_tower' },
  { atSeconds: 285, groupId: 'ash_legion', order: 'attack_zone', targetZone: 'salt_ford', formation: 'column', stance: 'aggressive' },
  { atSeconds: 345, groupId: 'night_riders', order: 'attack_zone', targetZone: 'oyster_town', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 425, groupId: 'iron_host', order: 'attack_zone', targetZone: 'long_causeway', formation: 'line', stance: 'aggressive' },
];

const LAST_LIGHT_SCRIPT: readonly ScriptedAiOrder[] = [
  { atSeconds: 8, groupId: 'iron_host', order: 'attack_zone', targetZone: 'central_field', formation: 'line', stance: 'aggressive' },
  { atSeconds: 14, groupId: 'ash_legion', order: 'attack_zone', targetZone: 'central_field', formation: 'line', stance: 'aggressive' },
  { atSeconds: 22, groupId: 'northern_spears', order: 'attack_zone', targetZone: 'central_field', formation: 'double_line' },
  { atSeconds: 28, groupId: 'black_arrows', order: 'attack_zone', targetZone: 'central_field', formation: 'loose' },
  { atSeconds: 38, groupId: 'storm_riders', order: 'attack_zone', targetZone: 'village', formation: 'wedge' },
  { atSeconds: 44, groupId: 'night_riders', order: 'attack_zone', targetZone: 'east_field', formation: 'wedge' },
  { atSeconds: 34, groupId: 'ash_shot', order: 'attack_zone', targetZone: 'central_field', formation: 'double_line', stance: 'aggressive' },
  { atSeconds: 62, groupId: 'black_guns', order: 'attack_zone', targetZone: 'central_field', formation: 'loose', stance: 'hold_ground' },
  { atSeconds: 70, groupId: 'siege_train', order: 'attack_zone', targetZone: 'central_field', formation: 'loose' },
  { atSeconds: 110, groupId: 'ashen_surgeons', order: 'move', targetZone: 'central_hill', formation: 'loose' },
  { atSeconds: 95, groupId: 'ashen_reserve', order: 'attack_zone', targetZone: 'central_field', formation: 'column' },
  { atSeconds: 145, groupId: 'storm_riders', order: 'attack_zone', targetZone: 'player_base', formation: 'wedge' },
  { atSeconds: 175, groupId: 'iron_host', order: 'attack_zone', targetZone: 'player_base', formation: 'column' },
];

export const SCENARIOS: Record<ScenarioId, ScenarioDefinition> = {
  riverwatch: {
    id: 'riverwatch',
    mapId: 'river_vale',
    eyebrow: 'I · THE RIVER LINE',
    name: 'Riverwatch',
    description: 'Hold three crossings as the Ashen Host unfolds a measured, many-front assault.',
    objective: 'Break the northern line, then take the Ashen King.',
    pressure: 'Rising',
    duration: '6–15 min',
    tags: ['Balanced', 'Three fronts', 'Classic'],
    location: 'Three Crossings',
    briefingLine: 'Hold the three crossings before the Ashen Host envelops the valley.',
    battleOrders: ['Break the northern line', 'Take the Ashen King'],
    battleFacts: ['~4,400 enemy', '3 crossings', '6–15 min'],
    playerArmyName: 'Crownlands',
    enemyArmyName: 'Ashen Host',
    playerGroups: PLAYER_GROUPS,
    enemyGroups: ENEMY_GROUPS,
    kingSpecs: KING_SPECS,
    aiScript: RIVERWATCH_SCRIPT,
  },
  broken_bridgehead: {
    id: 'broken_bridgehead',
    mapId: 'river_vale',
    eyebrow: 'II · ACROSS THE WATER',
    name: 'Broken Bridgehead',
    description: 'Your vanguard begins north of the river, exposed and already within striking distance.',
    objective: 'Hold the bridgehead or withdraw in order before the counterattack cuts it off.',
    pressure: 'Immediate',
    duration: '5–12 min',
    tags: ['Offensive', 'Exposed line', 'Fast'],
    location: 'Northern Bank',
    briefingLine: 'Hold the northern foothold before the counterattack cuts your road home.',
    battleOrders: ['Hold the bridgehead', 'Keep the central span open'],
    battleFacts: ['~4,400 enemy', '1 retreat route', '5–12 min'],
    playerArmyName: 'Crown Vanguard',
    enemyArmyName: 'Ashen Host',
    playerGroups: BRIDGEHEAD_PLAYER,
    enemyGroups: BRIDGEHEAD_ENEMY,
    kingSpecs: KING_SPECS,
    aiScript: BRIDGEHEAD_SCRIPT,
  },
  last_light: {
    id: 'last_light',
    mapId: 'river_vale',
    eyebrow: 'III · THE FINAL MILE',
    name: 'Last Light',
    description: 'The crossings are lost. Reform around the Crown while the enemy closes from three sides.',
    objective: 'Keep King Aldric free, blunt the assault, and create a road north.',
    pressure: 'Severe',
    duration: '5–10 min',
    tags: ['Defensive', 'Close quarters', 'Hard start'],
    location: 'Crown Encampment',
    briefingLine: 'The crossings are lost. Keep the Ashen Host from reaching King Aldric.',
    battleOrders: ['Hold the Crown encampment', 'Break the Ashen pursuit'],
    battleFacts: ['~4,400 enemy', 'King exposed', '5–10 min'],
    playerArmyName: 'Crown Remnant',
    enemyArmyName: 'Ashen Pursuit',
    playerGroups: LAST_LIGHT_PLAYER,
    enemyGroups: LAST_LIGHT_ENEMY,
    kingSpecs: KING_SPECS,
    aiScript: LAST_LIGHT_SCRIPT,
  },
  cinder_road: {
    id: 'cinder_road',
    mapId: 'ashfall_pass',
    eyebrow: 'IV · THE BURNING ROAD',
    name: 'Cinder Road',
    description:
      'A dead volcanic spine, broken open in two places, and an army that has to go through one of them.',
    objective: 'Force a gap, take the terrace above it, and reach the Ash Citadel.',
    pressure: 'Deliberate',
    duration: '8–16 min',
    tags: ['Assault', 'Two gaps', 'Siege'],
    location: 'Ashfall Pass',
    briefingLine: 'The spine cannot be crossed. Force Cinder Gap or the Ashfall Gate.',
    battleOrders: ['Force one of the two gaps', 'Take the Ashen King'],
    battleFacts: ['~4,600 enemy', '2 gaps, held', '8–16 min'],
    playerArmyName: 'Crown Vanguard',
    enemyArmyName: 'Ashen Wardens',
    playerGroups: CINDER_ROAD_PLAYER,
    enemyGroups: CINDER_ROAD_ENEMY,
    kingSpecs: KING_SPECS,
    aiScript: CINDER_ROAD_SCRIPT,
  },
  ashen_gate: {
    id: 'ashen_gate',
    mapId: 'ashfall_pass',
    eyebrow: 'V · THE FAR SIDE',
    name: 'The Ashen Gate',
    description:
      'Your army is through the gate and above the spine. The one road home is four hundred yards wide.',
    objective: 'Hold Emberhold and keep the Ashfall Gate open behind you.',
    pressure: 'Immediate',
    duration: '6–12 min',
    tags: ['Exposed', 'One road home', 'Hard start'],
    location: 'Emberhold',
    briefingLine: 'You are across the spine. Keep the gate behind you open.',
    battleOrders: ['Hold Emberhold', 'Keep the Ashfall Gate open'],
    battleFacts: ['~4,400 enemy', '1 road home', '6–12 min'],
    playerArmyName: 'Crown Vanguard',
    enemyArmyName: 'Ashen Host',
    playerGroups: ASHEN_GATE_PLAYER,
    enemyGroups: ASHEN_GATE_ENEMY,
    kingSpecs: KING_SPECS,
    aiScript: ASHEN_GATE_SCRIPT,
  },
  goldmere_fields: {
    id: 'goldmere_fields',
    mapId: 'goldmere',
    eyebrow: 'VI · THE OPEN FIELD',
    name: 'Goldmere Fields',
    description:
      'Harvest country with nothing in it. No river, no pass, and both flanks open the whole way round.',
    objective: 'Beat the Ashen host in the open and ride down its king.',
    pressure: 'Building',
    duration: '7–14 min',
    tags: ['Open ground', 'Cavalry', 'Manoeuvre'],
    location: 'Goldmere',
    briefingLine: 'Open country. Nothing here protects a flank but the men on it.',
    battleOrders: ['Hold Goldmere Town', 'Turn a flank and take their king'],
    battleFacts: ['~4,400 enemy', '660 enemy horse', '7–14 min'],
    playerArmyName: 'Crownlands',
    enemyArmyName: 'Ashen Host',
    playerGroups: GOLDMERE_PLAYER,
    enemyGroups: GOLDMERE_ENEMY,
    kingSpecs: KING_SPECS,
    aiScript: GOLDMERE_SCRIPT,
  },
  the_long_causeway: {
    id: 'the_long_causeway',
    mapId: 'sunken_causeway',
    eyebrow: 'VII · THE DROWNED COAST',
    name: 'The Long Causeway',
    description:
      'A tidal channel cut corner to corner. One raised road, one ford, and an hour of marching between them.',
    objective: 'Cross the channel and take the Ashen Anchorage.',
    pressure: 'Grinding',
    duration: '9–18 min',
    tags: ['Crossing', 'Split fronts', 'Siege'],
    location: 'The Sunken Coast',
    briefingLine: 'One causeway, one ford, and a long march between them. Choose.',
    battleOrders: ['Take the Long Causeway or the Salt Ford', 'Take the Ashen King'],
    battleFacts: ['~4,400 enemy', '2 crossings, far apart', '9–18 min'],
    playerArmyName: 'Crown Landing',
    enemyArmyName: 'Ashen Coastguard',
    playerGroups: LONG_CAUSEWAY_PLAYER,
    enemyGroups: LONG_CAUSEWAY_ENEMY,
    kingSpecs: KING_SPECS,
    aiScript: LONG_CAUSEWAY_SCRIPT,
  },
};

export function getScenarioDefinition(id: ScenarioId): ScenarioDefinition {
  return SCENARIOS[id];
}

/* -------------------------------------------------------------- construction */

const slotBufferX = new Float32Array(2048);
const slotBufferY = new Float32Array(2048);

function formationFits(
  formation: Formation,
  count: number,
  anchor: Vector2D,
  facing: number,
  xs: Float32Array,
  ys: Float32Array,
): boolean {
  fillFormationSlots(formation, count, anchor, facing, xs, ys);
  for (let index = 0; index < count; index += 1) {
    if (!isPassable(xs[index] ?? anchor.x, ys[index] ?? anchor.y)) return false;
  }
  return true;
}

/**
 * Authored anchors describe where a regiment belongs, not just where its first
 * rank stands. Move a deployment the shortest deterministic distance required
 * to put the whole formation on legal ground. This prevents a broad line from
 * being stamped through a river merely because its centre happened to be dry.
 */
function safeDeploymentAnchor(
  formation: Formation,
  count: number,
  authored: Vector2D,
  facing: number,
  xs: Float32Array,
  ys: Float32Array,
): Vector2D {
  if (formationFits(formation, count, authored, facing, xs, ys)) return authored;

  const map = activeBattleMap();
  const side = map.barrier === undefined ? 0 : Math.sign(authored.y - barrierCenterAt(authored.x));
  const candidate = { x: authored.x, y: authored.y };
  const directions = 24;

  for (let radius = 50; radius <= 1600; radius += 50) {
    for (let direction = 0; direction < directions; direction += 1) {
      const angle = (direction / directions) * Math.PI * 2;
      candidate.x = authored.x + Math.cos(angle) * radius;
      candidate.y = authored.y + Math.sin(angle) * radius;
      if (
        side !== 0 &&
        Math.sign(candidate.y - barrierCenterAt(candidate.x)) !== side
      ) {
        continue;
      }
      if (formationFits(formation, count, candidate, facing, xs, ys)) {
        return { x: candidate.x, y: candidate.y };
      }
    }
  }

  // This should only be reachable for an authoring error too large to repair.
  // Keep the original position so the scenario remains deterministic and the
  // invalid deployment is visible to validation rather than silently teleporting.
  fillFormationSlots(formation, count, authored, facing, xs, ys);
  return authored;
}

/**
 * Creates a group and spawns its units directly onto their formation slots, so
 * the battle opens with every army already dressed in formation.
 */
export function createGroupFromSpec(state: GameState, spec: GroupSpec): ArmyGroup {
  const facing = spec.ownerId === 'player' ? FACING_NORTH : FACING_SOUTH;
  const total = spec.composition.reduce((sum, [, count]) => sum + count, 0);
  const slot = state.groups.length;
  const xs = total <= slotBufferX.length ? slotBufferX : new Float32Array(total);
  const ys = total <= slotBufferY.length ? slotBufferY : new Float32Array(total);
  const deployment = safeDeploymentAnchor(spec.formation, total, spec.anchor, facing, xs, ys);

  const group: ArmyGroup = {
    id: spec.id,
    name: spec.name,
    ownerId: spec.ownerId,
    members: [],
    formation: spec.formation,
    stance: spec.stance,
    order: { kind: 'idle', issuedAtTick: 0 },
    anchor: { x: deployment.x, y: deployment.y },
    facing,
    morale: 100,
    moraleState: 'confident',
    path: [],
    stallTicks: 0,
    lastReplanTick: -1,
    initialStrength: total,
    homeZone: zoneAt(deployment.x, deployment.y) as ZoneId,
    lastCasualtyTick: -1,
    recentCasualties: 0,
    routing: false,
    engagement: 0,
    encirclement: 0,
    crowding: 0,
    fatigue: 0,
    succour: 0,
  };

  const faction = factionOf(spec.ownerId);
  let slotIndex = 0;
  for (const [category, count] of spec.composition) {
    for (let n = 0; n < count; n += 1) {
      const x = xs[slotIndex] ?? group.anchor.x;
      const y = ys[slotIndex] ?? group.anchor.y;
      const unitIndex = state.units.spawn(faction, slot, category, x, y);
      if (unitIndex >= 0) group.members.push(unitIndex);
      slotIndex += 1;
    }
  }

  group.members.sort((a, b) => a - b);
  group.initialStrength = group.members.length;
  registerGroup(state, group);
  return group;
}

export function buildScenario(state: GameState, scenarioId: ScenarioId = 'riverwatch'): void {
  const scenario = getScenarioDefinition(scenarioId);
  // The map is chosen here and never again: every anchor below, and every
  // geographic answer for the rest of the battle, is read against it.
  state.mapId = scenario.mapId;
  useBattleMap(scenario.mapId);
  state.players.player.name = scenario.playerArmyName;
  state.players.enemy.name = scenario.enemyArmyName;
  for (const spec of scenario.playerGroups) createGroupFromSpec(state, spec);
  for (const spec of scenario.enemyGroups) createGroupFromSpec(state, spec);
  seatKings(state, scenario.kingSpecs);
}

/**
 * Seats both kings with their guards and records the strength each side is
 * measured against, so a general collapse can be recognised later.
 */
function seatKings(state: GameState, kingSpecs: readonly KingSpec[]): void {
  for (const spec of kingSpecs) {
    const guard = findGroup(state, spec.guardGroupId);
    if (guard === undefined) throw new Error(`Missing royal guard "${spec.guardGroupId}".`);

    state.objective.kings[spec.ownerId] = {
      ownerId: spec.ownerId,
      name: spec.name,
      position: { x: guard.anchor.x, y: guard.anchor.y },
      guardGroupId: spec.guardGroupId,
      guardStrength: guard.members.length,
      captureProgress: 0,
      captured: false,
      besieged: false,
      defenders: guard.members.length,
      attackers: 0,
    };
  }

  for (const group of state.groups) {
    state.objective.initialStrength[group.ownerId] += group.members.length;
  }
}
