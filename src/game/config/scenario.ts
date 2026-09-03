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
  AUTHORED_SCENARIO_IDS,
  type AuthoredScenarioId,
  type ScenarioId,
  type ScriptedAiOrder,
  type SimulationOptions,
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
 * The authored operations.
 *
 * An operation is a map, a deployment on it, and a written enemy commander.
 * They draw smaller field forces from the same named regimental catalog, so
 * stable ids still let one WebMCP surface and one enemy commander serve every
 * battle without filling every opening with thirteen labels per side.
 *
 * Each operation exists to pose one problem the others do not:
 *
 *   I.   Bridge of Knives — a trap. The bow line is bait, and the whole
 *        operation turns on how long you can bear to leave it there.
 *   II.  The Ember Gate — two ways through a wall, both of them two-way. The
 *        gap you are not using is the gap they will use.
 *   III. The Salt Tide — your sovereign is on the wrong side of the water and
 *        the tide does not care. Everything is a race.
 *   IV.  The Open Hand — no feature on the whole field. Two open ends, and two
 *        bodies of horse already going round them.
 *
 * Openings are quiet enough to command by hand, and every timeline after the
 * first deliberately overloads a single human a few minutes in — which is the
 * moment the Marshal earns its place.
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

/* --------------------------------------------------------- orders of battle */

/**
 * The Crown army.
 *
 * Thirteen regiments: the rewritten line and horse retain the gunpowder,
 * artillery and field-support arms added after this operation branch began.
 * The Kingsguard carry King Aldric and remain the one regiment that cannot be
 * spent freely.
 *
 * Anchors here are the River Vale deployment. Each operation selects what it
 * needs and restates changed positions through `redeploy`, so a regiment keeps
 * its id, name and character wherever it is sent.
 */
export const CROWN_ARMY: readonly GroupSpec[] = [
  {
    id: 'vanguard',
    name: 'Crown Vanguard',
    ownerId: 'player',
    anchor: { x: 2900, y: 3080 },
    formation: 'line',
    stance: 'defensive',
    composition: [['infantry', 620], ['heavy_infantry', 180]],
  },
  {
    id: 'ironbacks',
    name: 'The Ironbacks',
    ownerId: 'player',
    anchor: { x: 5100, y: 3020 },
    formation: 'line',
    stance: 'hold_ground',
    composition: [['heavy_infantry', 380]],
  },
  {
    id: 'hedge',
    name: 'The Hedge',
    ownerId: 'player',
    anchor: { x: 4000, y: 3220 },
    formation: 'double_line',
    stance: 'hold_ground',
    composition: [['spearman', 420]],
  },
  {
    id: 'longbows',
    name: 'Longbow Corps',
    ownerId: 'player',
    anchor: { x: 4000, y: 2960 },
    formation: 'double_line',
    stance: 'defensive',
    composition: [['archer', 460]],
  },
  {
    id: 'greyriders',
    name: 'Grey Riders',
    ownerId: 'player',
    anchor: { x: 1500, y: 3400 },
    formation: 'wedge',
    stance: 'aggressive',
    composition: [['cavalry', 280]],
  },
  {
    id: 'lancers',
    name: 'Vale Lancers',
    ownerId: 'player',
    anchor: { x: 7150, y: 3150 },
    formation: 'wedge',
    stance: 'aggressive',
    composition: [['cavalry', 200]],
  },
  {
    id: 'hammers',
    name: 'Hammer Battery',
    ownerId: 'player',
    anchor: { x: 4950, y: 3300 },
    formation: 'loose',
    stance: 'hold_ground',
    composition: [['siege', 40]],
  },
  {
    id: 'arquebusiers',
    name: 'Crown Arquebusiers',
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
    id: 'outrunners',
    name: 'Outrunners',
    ownerId: 'player',
    anchor: { x: 1750, y: 3000 },
    formation: 'loose',
    stance: 'defensive',
    composition: [['scout', 45]],
  },
  {
    id: 'fenmen',
    name: 'Fenmen Levy',
    ownerId: 'player',
    anchor: { x: 4000, y: 4020 },
    formation: 'block',
    stance: 'defensive',
    composition: [['infantry', 380], ['spearman', 120], ['archer', 80]],
  },
  {
    id: 'kingsguard',
    name: 'The Kingsguard',
    ownerId: 'player',
    anchor: { x: 4000, y: 4520 },
    formation: 'square',
    stance: 'hold_ground',
    composition: [['heavy_infantry', 250], ['spearman', 120]],
  },
];

/**
 * The Ashen host.
 *
 * Deliberately the Crown army's mirror with a heavier centre and one more
 * horseman, plus the same later gunpowder and support arms as the current
 * battlefield simulation.
 */
export const ASHEN_ARMY: readonly GroupSpec[] = [
  {
    id: 'cinder_host',
    name: 'The Cinder Host',
    ownerId: 'enemy',
    anchor: { x: 3820, y: 1760 },
    formation: 'line',
    stance: 'aggressive',
    composition: [['infantry', 700], ['heavy_infantry', 240]],
  },
  {
    id: 'blackforge',
    name: 'Blackforge Foot',
    ownerId: 'enemy',
    anchor: { x: 4200, y: 1520 },
    formation: 'line',
    stance: 'aggressive',
    composition: [['heavy_infantry', 320]],
  },
  {
    id: 'thornspears',
    name: 'Thornspear Wall',
    ownerId: 'enemy',
    anchor: { x: 4000, y: 1980 },
    formation: 'double_line',
    stance: 'hold_ground',
    composition: [['spearman', 400]],
  },
  {
    id: 'emberbows',
    name: 'Emberbow Ranks',
    ownerId: 'enemy',
    anchor: { x: 4000, y: 1250 },
    formation: 'double_line',
    stance: 'defensive',
    composition: [['archer', 470]],
  },
  {
    id: 'ash_riders',
    name: 'Ash Riders',
    ownerId: 'enemy',
    anchor: { x: 2400, y: 1600 },
    formation: 'wedge',
    stance: 'aggressive',
    composition: [['cavalry', 300]],
  },
  {
    id: 'dusk_riders',
    name: 'Dusk Riders',
    ownerId: 'enemy',
    anchor: { x: 6300, y: 1700 },
    formation: 'wedge',
    stance: 'aggressive',
    composition: [['cavalry', 220]],
  },
  {
    id: 'slagworks',
    name: 'Slagworks Train',
    ownerId: 'enemy',
    anchor: { x: 4000, y: 980 },
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
    id: 'crow_scouts',
    name: 'Crow Scouts',
    ownerId: 'enemy',
    anchor: { x: 5400, y: 1600 },
    formation: 'loose',
    stance: 'defensive',
    composition: [['scout', 45]],
  },
  {
    id: 'ember_reserve',
    name: 'Ember Reserve',
    ownerId: 'enemy',
    anchor: { x: 4000, y: 820 },
    formation: 'block',
    stance: 'defensive',
    composition: [['infantry', 380], ['spearman', 120]],
  },
  {
    id: 'ashen_guard',
    name: 'The Ashen Guard',
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
  { ownerId: 'player', name: 'King Aldric', guardGroupId: 'kingsguard' },
  { ownerId: 'enemy', name: 'The Ashen King', guardGroupId: 'ashen_guard' },
];

/** Where an operation came from. The War Council labels designed ones plainly. */
export type ScenarioOrigin = 'authored' | 'designed';

export interface ScenarioDefinition {
  id: ScenarioId;
  /** The ground it is fought on. Deployments are in that map's coordinates. */
  mapId: BattleMapId;
  /** Shown as the seal on the operation card. Two characters at most. */
  numeral: string;
  name: string;
  location: string;
  /** One paragraph of situation for the briefing. */
  summary: string;
  /** One line, carried across the cut onto the battlefield itself. */
  briefingLine: string;
  /** The one thing that makes this operation itself and not another. */
  twist: string;
  objective: string;
  pressure: string;
  duration: string;
  tags: readonly string[];
  battleOrders: readonly string[];
  battleFacts: readonly string[];
  playerArmyName: string;
  enemyArmyName: string;
  playerGroups: readonly GroupSpec[];
  enemyGroups: readonly GroupSpec[];
  kingSpecs: readonly KingSpec[];
  aiScript: readonly ScriptedAiOrder[];
  origin: ScenarioOrigin;
}

type GroupChanges = Partial<
  Record<string, Partial<Pick<GroupSpec, 'anchor' | 'formation' | 'stance' | 'composition'>>>
>;

/** Restates only what an operation changes about a regiment. */
function redeploy(groups: readonly GroupSpec[], changes: GroupChanges): GroupSpec[] {
  return groups.map((group) => ({ ...group, ...changes[group.id] }));
}

/** Picks a scenario-sized field force in an explicit, deterministic order. */
function fieldForce(groups: readonly GroupSpec[], ids: readonly string[]): GroupSpec[] {
  return ids.map((id) => {
    const group = groups.find((candidate) => candidate.id === id);
    if (group === undefined) throw new Error(`Unknown regiment in scenario field force: ${id}`);
    return group;
  });
}

const VALE_BOWMEN: GroupSpec = {
  id: 'vale_bowmen',
  name: 'Vale Bowmen',
  ownerId: 'player',
  anchor: { x: 4300, y: 3060 },
  formation: 'double_line',
  stance: 'defensive',
  composition: [['archer', 240]],
};

const CINDER_BOWMEN: GroupSpec = {
  id: 'cinder_bowmen',
  name: 'Cinder Bowmen',
  ownerId: 'enemy',
  anchor: { x: 4400, y: 1320 },
  formation: 'double_line',
  stance: 'defensive',
  composition: [['archer', 240]],
};

/** Six clear battlefield roles used by the two introductory operations. */
const SIMPLE_CROWN_FORCE = fieldForce(
  redeploy([...CROWN_ARMY, VALE_BOWMEN], {
    vanguard: { composition: [['heavy_infantry', 360]] },
    ironbacks: { composition: [['heavy_infantry', 300]] },
    greyriders: { composition: [['cavalry', 220]] },
    longbows: { composition: [['archer', 280]] },
    kingsguard: { composition: [['heavy_infantry', 120]] },
  }),
  ['vanguard', 'ironbacks', 'greyriders', 'longbows', 'vale_bowmen', 'kingsguard'],
);

const SIMPLE_ASHEN_FORCE = fieldForce(
  redeploy([...ASHEN_ARMY, CINDER_BOWMEN], {
    cinder_host: { composition: [['heavy_infantry', 420]] },
    blackforge: { composition: [['heavy_infantry', 300]] },
    ash_riders: { composition: [['cavalry', 220]] },
    emberbows: { composition: [['archer', 280]] },
    ashen_guard: { composition: [['heavy_infantry', 120]] },
  }),
  ['cinder_host', 'blackforge', 'ash_riders', 'emberbows', 'cinder_bowmen', 'ashen_guard'],
);

/* ------------------------------------------- I. Bridge of Knives: the trap */

/**
 * River Vale, from the south bank.
 *
 * The deployment is the operation. Two bow regiments stand alone at the
 * central bridge, which reads to the Ashen commander as a thin centre worth
 * crossing. Two bodies of knights sit back and wide of it, with one cavalry
 * wing waiting in the western wood.
 *
 * What the ground then does is the point: a regiment that crosses a bridge
 * arrives crowded — packed so tightly it cannot swing — and a crowded regiment
 * that is closed on from two sides is surrounded as well. A commander who
 * springs this early meets the Cinder Host in the open at full strength. A
 * commander who waits meets half of it, wedged on a bridgehead, at half value.
 *
 * The six roles deploy to teach the opposite lesson: the bow line is exposed on
 * purpose and the striking force is held wide until the crossing is crowded.
 */
const KNIVES_SCRIPT: readonly ScriptedAiOrder[] = [
  // The bait is taken: the heavy centre goes straight down the bridge road.
  { atSeconds: 15, groupId: 'cinder_host', order: 'attack_zone', targetZone: 'central_bridge', formation: 'column', stance: 'aggressive' },
  { atSeconds: 22, groupId: 'blackforge', order: 'attack_zone', targetZone: 'central_bridge', formation: 'column', stance: 'aggressive' },
  { atSeconds: 30, groupId: 'cinder_bowmen', order: 'move', targetZone: 'central_bridge', formation: 'loose' },
  { atSeconds: 55, groupId: 'emberbows', order: 'move', targetZone: 'enemy_outer_defense', formation: 'loose' },
  // And unfolds on the near bank, which is where it is worth killing.
  { atSeconds: 95, groupId: 'cinder_host', order: 'attack_zone', targetZone: 'central_field', formation: 'line' },
  { atSeconds: 108, groupId: 'blackforge', order: 'attack_zone', targetZone: 'central_field', formation: 'line' },
  { atSeconds: 122, groupId: 'cinder_bowmen', order: 'attack_zone', targetZone: 'central_field', formation: 'loose' },
  // The cavalry flank opens late, so an army that emptied it is punished.
  { atSeconds: 190, groupId: 'emberbows', order: 'attack_zone', targetZone: 'central_bridge', formation: 'loose' },
  { atSeconds: 240, groupId: 'ash_riders', order: 'attack_zone', targetZone: 'west_crossing', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 330, groupId: 'ash_riders', order: 'attack_zone', targetZone: 'village', formation: 'wedge' },
  // If nothing has decided the field by now, the horse go for the Crown.
  { atSeconds: 430, groupId: 'ash_riders', order: 'attack_zone', targetZone: 'player_base', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 500, groupId: 'cinder_host', order: 'attack_zone', targetZone: 'player_base', formation: 'column' },
];

const KNIVES_PLAYER = redeploy(SIMPLE_CROWN_FORCE, {
  vanguard: { anchor: { x: 2900, y: 3260 }, formation: 'line', stance: 'defensive' },
  ironbacks: { anchor: { x: 5100, y: 3260 }, formation: 'line', stance: 'hold_ground' },
  longbows: { anchor: { x: 3600, y: 2960 }, formation: 'double_line' },
  vale_bowmen: { anchor: { x: 4400, y: 2960 }, formation: 'double_line' },
  greyriders: { anchor: { x: 1500, y: 3400 }, formation: 'wedge', stance: 'aggressive' },
  kingsguard: { anchor: { x: 4000, y: 4520 }, formation: 'square', stance: 'hold_ground' },
});

const KNIVES_ENEMY = SIMPLE_ASHEN_FORCE;

/* ---------------------------------------------- II. The Ember Gate: the door */

/**
 * Ashfall Pass, from below the spine.
 *
 * Two gaps, four kilometres apart, both held from the high ground above them.
 * The army is split to face both: the Vanguard, the Hedge and the bows below
 * Cinder Gap in the west, the Ironbacks and the battery below the Ashfall Gate
 * in the east. Either can be forced. Neither can be forced cheaply.
 *
 * The trick is that a gap is a door, and a door opens both ways. Four minutes
 * in the Cinder Host comes down through the western gap and makes for the
 * Crown Camp, and a commander who has fed his whole army north loses his king
 * to a column he never saw. The Fenmen are placed where a rear guard belongs
 * for exactly that reason — and taking them forward is a real choice, not a
 * mistake, because the gate does not break itself.
 */
const GATE_PLAYER = redeploy(fieldForce(CROWN_ARMY, [
  'vanguard',
  'hedge',
  'longbows',
  'ironbacks',
  'hammers',
  'arquebusiers',
  'fenmen',
  'kingsguard',
]), {
  vanguard: { anchor: { x: 2500, y: 3400 }, stance: 'aggressive' },
  hedge: { anchor: { x: 2650, y: 3660 }, formation: 'line' },
  longbows: { anchor: { x: 2960, y: 3600 }, formation: 'loose' },
  ironbacks: { anchor: { x: 5700, y: 3400 }, stance: 'aggressive' },
  hammers: { anchor: { x: 5760, y: 3760 } },
  greyriders: { anchor: { x: 1450, y: 3300 } },
  lancers: { anchor: { x: 6650, y: 3600 } },
  outrunners: { anchor: { x: 4000, y: 3450 } },
  fenmen: { anchor: { x: 4000, y: 4050 } },
  kingsguard: { anchor: { x: 4000, y: 4500 } },
});

const GATE_ENEMY = redeploy(fieldForce(ASHEN_ARMY, [
  'thornspears',
  'emberbows',
  'blackforge',
  'slagworks',
  'cinder_host',
  'ash_riders',
  'dusk_riders',
  'ashen_guard',
]), {
  thornspears: { anchor: { x: 2350, y: 1880 }, formation: 'double_line', stance: 'hold_ground' },
  emberbows: { anchor: { x: 2100, y: 1600 }, formation: 'loose' },
  blackforge: { anchor: { x: 5750, y: 1900 }, stance: 'hold_ground' },
  slagworks: { anchor: { x: 6150, y: 1700 } },
  cinder_host: { anchor: { x: 4000, y: 1850 }, stance: 'defensive' },
  ash_riders: { anchor: { x: 2000, y: 1400 } },
  dusk_riders: { anchor: { x: 6400, y: 1550 } },
  crow_scouts: { anchor: { x: 4600, y: 1650 } },
  ember_reserve: { anchor: { x: 5200, y: 1150 } },
  ashen_guard: { anchor: { x: 4000, y: 700 } },
});

const GATE_SCRIPT: readonly ScriptedAiOrder[] = [
  // Both doors are shut and watched before anything else happens.
  { atSeconds: 10, groupId: 'thornspears', order: 'defend_zone', targetZone: 'cinder_gap', formation: 'double_line', stance: 'hold_ground' },
  { atSeconds: 14, groupId: 'blackforge', order: 'defend_zone', targetZone: 'ashfall_gate', formation: 'line', stance: 'hold_ground' },
  { atSeconds: 20, groupId: 'emberbows', order: 'move', targetZone: 'obsidian_wood', formation: 'loose' },
  { atSeconds: 26, groupId: 'slagworks', order: 'defend_zone', targetZone: 'emberhold', formation: 'loose', stance: 'hold_ground' },
  // The counter-column forms on the terrace, where it can reach either gap.
  { atSeconds: 120, groupId: 'cinder_host', order: 'move', targetZone: 'upper_terrace', formation: 'line' },
  { atSeconds: 170, groupId: 'ash_riders', order: 'attack_zone', targetZone: 'cinder_gap', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 210, groupId: 'ash_riders', order: 'attack_zone', targetZone: 'south_orchard', formation: 'wedge', stance: 'aggressive' },
  // And comes through the western door, southbound, at your camp.
  { atSeconds: 235, groupId: 'cinder_host', order: 'attack_zone', targetZone: 'cinder_gap', formation: 'column', stance: 'aggressive' },
  { atSeconds: 285, groupId: 'cinder_host', order: 'attack_zone', targetZone: 'smoke_road', formation: 'line', stance: 'aggressive' },
  { atSeconds: 300, groupId: 'dusk_riders', order: 'attack_zone', targetZone: 'ashfall_gate', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 335, groupId: 'dusk_riders', order: 'attack_zone', targetZone: 'slag_flats', formation: 'wedge' },
  { atSeconds: 365, groupId: 'cinder_host', order: 'attack_zone', targetZone: 'crown_camp', formation: 'column', stance: 'aggressive' },
  { atSeconds: 390, groupId: 'ash_riders', order: 'attack_zone', targetZone: 'crown_camp', formation: 'wedge', stance: 'aggressive' },
];

/* --------------------------------------------- III. The Salt Tide: the race */

/**
 * The Sunken Coast, with the King already across the water.
 *
 * A night raid on the Ashen Anchorage went in, went wrong, and left King
 * Aldric and the Kingsguard on the North Strand with the Ironbacks and nothing
 * else. The rest of the Crown army is on the near shore, and between the two
 * halves is a tidal channel with one raised road and one ford on it.
 *
 * Every clock in this operation runs the same way. The Ashen host is already
 * turning on the stranded half; the Thornspears sit on the far end of the
 * causeway so a relief column has to be paid for; and the Ashen King is at his
 * anchorage with a guard and very little else, because his host is out hunting
 * yours. Marching to the rescue is the obvious answer. Riding for his king
 * while he rides for yours is the other one, and it is not the worse of the two.
 */
const TIDE_PLAYER = redeploy(fieldForce(CROWN_ARMY, [
  'kingsguard',
  'ironbacks',
  'vanguard',
  'hedge',
  'longbows',
  'greyriders',
  'lancers',
  'culverins',
]), {
  kingsguard: { anchor: { x: 2350, y: 1750 }, formation: 'square', stance: 'hold_ground' },
  ironbacks: { anchor: { x: 2680, y: 1560 }, formation: 'line', stance: 'defensive' },
  vanguard: { anchor: { x: 3200, y: 3700 }, stance: 'aggressive' },
  hedge: { anchor: { x: 3080, y: 3960 } },
  longbows: { anchor: { x: 3420, y: 3900 }, formation: 'loose' },
  greyriders: { anchor: { x: 2100, y: 4000 } },
  lancers: { anchor: { x: 5200, y: 3700 } },
  hammers: { anchor: { x: 3300, y: 4160 } },
  culverins: { anchor: { x: 3800, y: 4200 } },
  outrunners: { anchor: { x: 5000, y: 3400 } },
  fenmen: { anchor: { x: 2900, y: 4400 } },
});

const TIDE_ENEMY = redeploy(fieldForce(ASHEN_ARMY, [
  'thornspears',
  'blackforge',
  'ash_riders',
  'cinder_host',
  'emberbows',
  'dusk_riders',
  'ashen_guard',
]), {
  thornspears: { anchor: { x: 3000, y: 2150 }, formation: 'double_line', stance: 'hold_ground' },
  blackforge: { anchor: { x: 6300, y: 1600 }, stance: 'hold_ground' },
  ash_riders: { anchor: { x: 1700, y: 1450 } },
  cinder_host: { anchor: { x: 4100, y: 1800 }, stance: 'aggressive' },
  emberbows: { anchor: { x: 4300, y: 1560 }, formation: 'loose' },
  dusk_riders: { anchor: { x: 6600, y: 1250 } },
  slagworks: { anchor: { x: 5600, y: 1000 } },
  crow_scouts: { anchor: { x: 5000, y: 1450 } },
  ember_reserve: { anchor: { x: 5350, y: 900 } },
  ashen_guard: { anchor: { x: 5800, y: 700 } },
});

const TIDE_SCRIPT: readonly ScriptedAiOrder[] = [
  // Both crossings are corked first, so the rescue has to be fought for.
  { atSeconds: 8, groupId: 'thornspears', order: 'defend_zone', targetZone: 'long_causeway', formation: 'double_line', stance: 'hold_ground' },
  { atSeconds: 12, groupId: 'blackforge', order: 'defend_zone', targetZone: 'salt_ford', formation: 'line', stance: 'hold_ground' },
  // Then the hunt for the stranded king begins, horse first.
  { atSeconds: 20, groupId: 'ash_riders', order: 'attack_zone', targetZone: 'north_strand', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 48, groupId: 'emberbows', order: 'move', targetZone: 'north_strand', formation: 'loose' },
  { atSeconds: 90, groupId: 'cinder_host', order: 'attack_zone', targetZone: 'north_strand', formation: 'line', stance: 'aggressive' },
  { atSeconds: 150, groupId: 'dusk_riders', order: 'move', targetZone: 'beacon_tower', formation: 'wedge' },
  { atSeconds: 205, groupId: 'dusk_riders', order: 'attack_zone', targetZone: 'north_strand', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 385, groupId: 'cinder_host', order: 'attack_zone', targetZone: 'long_causeway', formation: 'line' },
  { atSeconds: 500, groupId: 'ash_riders', order: 'attack_zone', targetZone: 'causeway_approach', formation: 'wedge', stance: 'aggressive' },
];

/* ---------------------------------------------- IV. The Open Hand: the flanks */

/**
 * Goldmere, where there is nothing to hold.
 *
 * No river, no spine, no channel — harvest country, a town, two woods and two
 * meres, and not one feature that protects a flank. Both armies form up facing
 * each other with a mile of stubble between them, and the only cover on the
 * field is Goldmere Town in the middle of it.
 *
 * The Ashen commander opens by sending both bodies of horse wide in the first
 * half minute, one round each flank, while his foot walks straight at the
 * town. That is the whole operation: a line with two open ends against two
 * hands closing behind it. Anchor a flank on the town or on Millbrook, beat
 * one wing of horse before the other arrives, or refuse a flank outright and
 * accept being pushed off the ground — but a straight line held to the end is
 * a line taken from three sides.
 */
const OPEN_HAND_PLAYER = redeploy(fieldForce(CROWN_ARMY, [
  'vanguard',
  'hedge',
  'ironbacks',
  'longbows',
  'greyriders',
  'lancers',
  'field_hospital',
  'kingsguard',
]), {
  vanguard: { anchor: { x: 4000, y: 3450 }, formation: 'line', stance: 'defensive' },
  hedge: { anchor: { x: 3550, y: 3600 }, formation: 'double_line', stance: 'hold_ground' },
  ironbacks: { anchor: { x: 4500, y: 3600 }, formation: 'line', stance: 'hold_ground' },
  longbows: { anchor: { x: 4050, y: 3820 }, formation: 'loose' },
  greyriders: { anchor: { x: 2200, y: 3600 } },
  lancers: { anchor: { x: 6100, y: 3500 } },
  hammers: { anchor: { x: 4300, y: 4020 } },
  outrunners: { anchor: { x: 5300, y: 3400 } },
  fenmen: { anchor: { x: 3300, y: 4150 } },
  kingsguard: { anchor: { x: 4000, y: 4500 } },
});

const OPEN_HAND_ENEMY = redeploy(fieldForce(ASHEN_ARMY, [
  'cinder_host',
  'blackforge',
  'thornspears',
  'emberbows',
  'ash_riders',
  'dusk_riders',
  'ashen_guard',
]), {
  cinder_host: { anchor: { x: 4200, y: 1750 } },
  blackforge: { anchor: { x: 3800, y: 1500 } },
  thornspears: { anchor: { x: 4300, y: 2050 } },
  emberbows: { anchor: { x: 4200, y: 1300 } },
  ash_riders: { anchor: { x: 2300, y: 1750 } },
  dusk_riders: { anchor: { x: 6400, y: 1700 } },
  slagworks: { anchor: { x: 4000, y: 950 } },
  crow_scouts: { anchor: { x: 5400, y: 1500 } },
  ember_reserve: { anchor: { x: 3400, y: 900 } },
  ashen_guard: { anchor: { x: 4000, y: 700 } },
});

const OPEN_HAND_SCRIPT: readonly ScriptedAiOrder[] = [
  // Both hands open in the first half minute, before a line can be re-dressed.
  { atSeconds: 20, groupId: 'ash_riders', order: 'attack_zone', targetZone: 'west_pasture', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 26, groupId: 'dusk_riders', order: 'attack_zone', targetZone: 'east_pasture', formation: 'wedge', stance: 'aggressive' },
  // The foot walks at the only cover on the field.
  { atSeconds: 45, groupId: 'cinder_host', order: 'attack_zone', targetZone: 'goldmere_town', formation: 'line' },
  { atSeconds: 58, groupId: 'thornspears', order: 'move', targetZone: 'goldmere_town', formation: 'double_line' },
  { atSeconds: 92, groupId: 'emberbows', order: 'move', targetZone: 'goldmere_town', formation: 'loose' },
  // And the hands begin to close.
  { atSeconds: 112, groupId: 'ash_riders', order: 'attack_zone', targetZone: 'millbrook', formation: 'wedge' },
  { atSeconds: 124, groupId: 'dusk_riders', order: 'attack_zone', targetZone: 'hollow_wood', formation: 'wedge' },
  { atSeconds: 152, groupId: 'cinder_host', order: 'attack_zone', targetZone: 'south_downs', formation: 'line', stance: 'aggressive' },
  { atSeconds: 168, groupId: 'blackforge', order: 'attack_zone', targetZone: 'south_downs', formation: 'line', stance: 'aggressive' },
  { atSeconds: 212, groupId: 'thornspears', order: 'attack_zone', targetZone: 'south_downs', formation: 'double_line' },
  { atSeconds: 284, groupId: 'ash_riders', order: 'attack_zone', targetZone: 'harvest_camp', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 304, groupId: 'dusk_riders', order: 'attack_zone', targetZone: 'harvest_camp', formation: 'wedge', stance: 'aggressive' },
  { atSeconds: 486, groupId: 'cinder_host', order: 'attack_zone', targetZone: 'harvest_camp', formation: 'column', stance: 'aggressive' },
];

/* ------------------------------------------------------------------ registry */

export const SCENARIOS: Record<AuthoredScenarioId, ScenarioDefinition> = {
  bridge_of_knives: {
    id: 'bridge_of_knives',
    mapId: 'river_vale',
    numeral: 'I',
    name: 'Bridge of Knives',
    location: 'The Vale Water',
    summary:
      'Your centre is two bow regiments, and it is meant to look weaker than it is. ' +
      'The Cinder Host will cross the middle bridge to break it. Your two knight regiments ' +
      'stand off the road, out of sight, waiting to be let loose on a column ' +
      'that is still wedged on a bridgehead.',
    briefingLine: 'Let them cross. Then close both wings and kill them against their own river.',
    twist: 'The bait is real. Springing the trap early is how you lose it.',
    objective: 'Break the Ashen centre on the near bank, then take the Ashen King.',
    pressure: 'Rising',
    duration: '7–15 min',
    tags: ['Ambush', 'Patience', 'Three crossings'],
    battleOrders: [
      'Hold the bridge screen — do not reinforce it early',
      'Close both wings once the crossing is packed',
      'Take the Ashen King',
    ],
    battleFacts: ['~1,600 Ashen', '6 regiments a side', 'Trap sprung at your word'],
    playerArmyName: 'Crownlands',
    enemyArmyName: 'Ashen Host',
    playerGroups: KNIVES_PLAYER,
    enemyGroups: KNIVES_ENEMY,
    kingSpecs: KING_SPECS,
    aiScript: KNIVES_SCRIPT,
    origin: 'authored',
  },
  ember_gate: {
    id: 'ember_gate',
    mapId: 'ashfall_pass',
    numeral: 'II',
    name: 'The Ember Gate',
    location: 'Ashfall Pass',
    summary:
      'The spine cannot be crossed. Cinder Gap in the west is narrow and held by spears with ' +
      'bows above them; the Ashfall Gate in the east is wider, held by heavy foot, and covered ' +
      'by a siege train in Emberhold. Force one. The other one stays open behind you, and the ' +
      'Ashen commander knows it.',
    briefingLine: 'Force a gap. Remember that the one you leave is a road to your own camp.',
    twist: 'Four minutes in, their centre comes south through the gap you did not use.',
    objective: 'Force a gap, hold your camp behind you, and reach the Ash Citadel.',
    pressure: 'Deliberate',
    duration: '8–16 min',
    tags: ['Assault', 'Two gaps', 'Rear guard'],
    battleOrders: [
      'Force Cinder Gap or the Ashfall Gate',
      'Keep something alive between their column and King Aldric',
      'Take the Ash Citadel',
    ],
    battleFacts: ['~3,100 Ashen', '2 gaps, both two-way', 'Siege above the gate'],
    playerArmyName: 'Crown Vanguard',
    enemyArmyName: 'Ashen Wardens',
    playerGroups: GATE_PLAYER,
    enemyGroups: GATE_ENEMY,
    kingSpecs: KING_SPECS,
    aiScript: GATE_SCRIPT,
    origin: 'authored',
  },
  salt_tide: {
    id: 'salt_tide',
    mapId: 'sunken_causeway',
    numeral: 'III',
    name: 'The Salt Tide',
    location: 'The Sunken Coast',
    summary:
      'The raid failed. King Aldric stands on the North Strand with the Kingsguard and the ' +
      'Ironbacks, on the wrong side of a tidal channel, and the Ashen host is already turning ' +
      'towards him. Your army is on the near shore. Between them: one raised causeway, one ' +
      'ford, and an hour of marching between the two.',
    briefingLine: 'Your king is across the water and they know it. Both sides are racing now.',
    twist: 'Their host is out hunting your king — which is what leaves theirs thinly guarded.',
    objective: 'Get King Aldric home, or take the Ashen King before they take yours.',
    pressure: 'Immediate',
    duration: '6–14 min',
    tags: ['Rescue', 'Race', 'Split army'],
    battleOrders: [
      'Break the cork on the Long Causeway',
      'Keep the Kingsguard alive and moving',
      'Or ride for the Anchorage and end it first',
    ],
    battleFacts: ['~3,000 Ashen', 'King cut off', '2 crossings, far apart'],
    playerArmyName: 'Crown Landing',
    enemyArmyName: 'Ashen Coastguard',
    playerGroups: TIDE_PLAYER,
    enemyGroups: TIDE_ENEMY,
    kingSpecs: KING_SPECS,
    aiScript: TIDE_SCRIPT,
    origin: 'authored',
  },
  open_hand: {
    id: 'open_hand',
    mapId: 'goldmere',
    numeral: 'IV',
    name: 'The Open Hand',
    location: 'Goldmere',
    summary:
      'Harvest country, and nothing in it. No river, no pass, no channel — one town in the ' +
      'middle of a mile of stubble, two woods, two meres, and not one feature that will hold a ' +
      'flank for you. Both hosts are drawn up facing each other, and theirs is the heavier in ' +
      'horse.',
    briefingLine: 'Open ground. Nothing here protects a flank but the men standing on it.',
    twist: 'Both their horse wings go wide in the first half minute, one round each end of you.',
    objective: 'Beat the Ashen host in the open and ride down its king.',
    pressure: 'Building',
    duration: '7–15 min',
    tags: ['Open ground', 'Cavalry', 'Both flanks'],
    battleOrders: [
      'Anchor a flank on Goldmere Town or Millbrook',
      'Beat one wing of horse before the other closes',
      'Ride down the Ashen King in the open',
    ],
    battleFacts: ['~3,000 Ashen', '520 Ashen horse', 'No ground holds a flank'],
    playerArmyName: 'Crownlands',
    enemyArmyName: 'Ashen Host',
    playerGroups: OPEN_HAND_PLAYER,
    enemyGroups: OPEN_HAND_ENEMY,
    kingSpecs: KING_SPECS,
    aiScript: OPEN_HAND_SCRIPT,
    origin: 'authored',
  },
};

/** The authored operations, in the order the War Council lists them. */
export const AUTHORED_SCENARIOS: readonly ScenarioDefinition[] = AUTHORED_SCENARIO_IDS.map(
  (id) => SCENARIOS[id],
);

export function isAuthoredScenarioId(value: string): value is AuthoredScenarioId {
  return (AUTHORED_SCENARIO_IDS as readonly string[]).includes(value);
}

export function getScenarioDefinition(id: AuthoredScenarioId): ScenarioDefinition {
  return SCENARIOS[id];
}

/**
 * The operation a set of simulation options asks for.
 *
 * A designed operation carries itself; an authored one is named. Asking for
 * `custom` without supplying the operation is an authoring error rather than a
 * silent fallback, because a battle nobody wrote is not a battle worth fighting.
 */
export function resolveScenario(
  options: Pick<SimulationOptions, 'scenarioId' | 'scenario'>,
): ScenarioDefinition {
  if (options.scenario !== undefined) return options.scenario;
  if (isAuthoredScenarioId(options.scenarioId)) return SCENARIOS[options.scenarioId];
  throw new Error(
    'A designed operation must be supplied in full; nothing is registered under "custom".',
  );
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
    shock: 0,
    blockedFire: 0,
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

/**
 * Raises both armies of an operation onto the map it is fought on.
 *
 * Takes the operation itself rather than its id, because a designed operation
 * has no id to look up — and because an engine that is handed its whole script
 * cannot read another engine's.
 */
export function buildScenario(state: GameState, scenario: ScenarioDefinition): void {
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
