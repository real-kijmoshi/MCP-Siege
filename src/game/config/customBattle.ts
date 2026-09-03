import { MAP_HEIGHT, MAP_WIDTH } from './battle';
import {
  BATTLE_MAPS,
  barrierCenterY,
  type BattleMapDefinition,
  type BattleMapId,
  type ZoneDefinition,
} from './maps';
import type { ScriptedAiOrder } from './matches';
import type { GroupSpec, KingSpec, ScenarioDefinition } from './scenario';
import {
  FORMATIONS,
  STANCES,
  UNIT_CATEGORIES,
  type Formation,
  type OrderKind,
  type PlayerId,
  type Stance,
  type UnitCategory,
  type Vector2D,
  type ZoneId,
} from '../types/domain';

/**
 * Designed operations.
 *
 * The War Council tools let an external Marshal write a battle of its own and
 * then fight it: a map, two orders of battle placed by named ground, and a
 * written enemy commander. This module is the only door into that, and it
 * turns a submitted design into an ordinary `ScenarioDefinition` — the same
 * shape the authored operations have, so nothing downstream of here can
 * tell the difference or needs a second code path.
 *
 * Everything the caller sends is treated as hostile until proved otherwise.
 * Locations are zone names rather than coordinates, strengths are bounded so a
 * design cannot exhaust the unit pool, and a battle that cannot be won — no
 * sovereign on one side, an enemy commander ordering regiments that do not
 * exist — is rejected outright rather than fought and quietly abandoned.
 */

export const CUSTOM_LIMITS = {
  minRegimentsPerSide: 3,
  maxRegimentsPerSide: 12,
  minRegimentStrength: 20,
  maxRegimentStrength: 1200,
  /** Per side. Two of these plus reinforcements stay inside the unit pool. */
  maxArmyStrength: 4200,
  maxScriptedOrders: 28,
  maxScriptSeconds: 900,
  maxNameLength: 48,
  maxTextLength: 400,
} as const;

/** Orders a written commander may give. All of them are ground, or nothing. */
export const SCRIPTABLE_ORDERS = [
  'move',
  'attack_zone',
  'defend_zone',
  'hold',
  'retreat',
  'scout',
] as const satisfies readonly OrderKind[];
export type ScriptableOrder = (typeof SCRIPTABLE_ORDERS)[number];

const ORDERS_NEEDING_GROUND: readonly ScriptableOrder[] = [
  'move',
  'attack_zone',
  'defend_zone',
  'scout',
];

export interface CustomRegimentSpec {
  /** Lowercase slug, unique within its side, used as the group id in play. */
  id: string;
  name: string;
  /** Named ground on the chosen map. The regiment forms up inside it. */
  zone: ZoneId;
  troops: ReadonlyArray<{ category: UnitCategory; count: number }>;
  formation?: Formation;
  stance?: Stance;
  /** Exactly one regiment a side must carry its sovereign. */
  carriesKing?: boolean;
}

export interface CustomOperationSpec {
  name: string;
  mapId: BattleMapId;
  summary?: string;
  briefingLine?: string;
  twist?: string;
  objective?: string;
  playerArmyName?: string;
  enemyArmyName?: string;
  playerKingName?: string;
  enemyKingName?: string;
  playerRegiments: readonly CustomRegimentSpec[];
  enemyRegiments: readonly CustomRegimentSpec[];
  /** The enemy commander, written as a timetable. May be empty. */
  enemyPlan?: readonly ScriptedAiOrder[];
}

/** A design that was rejected, with the reason a caller can act on. */
export class CustomOperationError extends Error {
  public constructor(
    message: string,
    public readonly suggestions: readonly string[] = [],
  ) {
    super(message);
    this.name = 'CustomOperationError';
  }
}

function fail(message: string, suggestions: readonly string[] = []): never {
  throw new CustomOperationError(message, suggestions);
}

const SLUG = /^[a-z][a-z0-9_]{1,30}$/;

function checkText(value: string | undefined, field: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`"${field}" must be a non-empty string when given.`);
  }
  if (value.length > max) fail(`"${field}" must be at most ${max} characters.`);
  return value.trim();
}

/**
 * Where the k-th regiment placed in a zone forms up.
 *
 * Spread deterministically around the zone centre on a golden-angle spiral, so
 * two regiments given the same ground do not spawn inside one another and the
 * same design always produces the same battle. `safeDeploymentAnchor` in
 * `scenario.ts` then walks any anchor that still lands on impassable ground.
 */
function anchorInZone(map: BattleMapDefinition, zoneId: ZoneId, index: number): Vector2D {
  const zone = map.zones.find((candidate) => candidate.id === zoneId);
  if (zone === undefined) {
    fail(`"${zoneId}" is not on ${map.name}.`, [
      `Ground on this map: ${map.zones.map((entry) => entry.id).join(', ')}.`,
    ]);
  }
  if (index === 0) return { x: zone.center.x, y: zone.center.y };

  const angle = index * 2.399_963; // golden angle, in radians
  const reach = Math.min(zone.radius * 0.55, 420) * Math.min(1, 0.45 + index * 0.18);
  return {
    x: clamp(zone.center.x + Math.cos(angle) * reach, 400, MAP_WIDTH - 400),
    y: clamp(zone.center.y + Math.sin(angle) * reach, 400, MAP_HEIGHT - 400),
  };
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function parseSide(
  map: BattleMapDefinition,
  regiments: readonly CustomRegimentSpec[],
  ownerId: PlayerId,
): { groups: GroupSpec[]; guardGroupId: string; strength: number } {
  const label = ownerId === 'player' ? 'playerRegiments' : 'enemyRegiments';
  if (!Array.isArray(regiments)) fail(`"${label}" must be an array of regiments.`);
  if (
    regiments.length < CUSTOM_LIMITS.minRegimentsPerSide ||
    regiments.length > CUSTOM_LIMITS.maxRegimentsPerSide
  ) {
    fail(
      `"${label}" must contain between ${CUSTOM_LIMITS.minRegimentsPerSide} and ` +
        `${CUSTOM_LIMITS.maxRegimentsPerSide} regiments.`,
    );
  }

  const groups: GroupSpec[] = [];
  const ids = new Set<string>();
  const placedInZone = new Map<ZoneId, number>();
  let guardGroupId: string | undefined;
  let strength = 0;

  for (const regiment of regiments) {
    if (typeof regiment !== 'object' || regiment === null) fail(`"${label}" holds a non-object.`);
    const id = regiment.id;
    if (typeof id !== 'string' || !SLUG.test(id)) {
      fail(`Regiment id "${String(id)}" must be a lowercase slug such as "left_wing".`);
    }
    if (ids.has(id)) fail(`Regiment id "${id}" is used twice in ${label}.`);
    ids.add(id);

    const name = checkText(regiment.name, `${id}.name`, CUSTOM_LIMITS.maxNameLength);
    if (name === undefined) fail(`Regiment "${id}" needs a name.`);

    if (!Array.isArray(regiment.troops) || regiment.troops.length === 0) {
      fail(`Regiment "${id}" needs at least one entry in "troops".`);
    }
    const composition: Array<readonly [UnitCategory, number]> = [];
    const categories = new Set<UnitCategory>();
    let total = 0;
    for (const entry of regiment.troops) {
      if (typeof entry !== 'object' || entry === null) fail(`"${id}.troops" holds a non-object.`);
      if (!(UNIT_CATEGORIES as readonly string[]).includes(entry.category)) {
        fail(`"${id}.troops" names an unknown troop type.`, [
          `Troop types: ${UNIT_CATEGORIES.join(', ')}.`,
        ]);
      }
      if (categories.has(entry.category)) fail(`"${id}" lists ${entry.category} twice.`);
      categories.add(entry.category);
      if (!Number.isInteger(entry.count) || entry.count < 1) {
        fail(`"${id}.troops" counts must be positive whole numbers.`);
      }
      total += entry.count;
      composition.push([entry.category, entry.count]);
    }
    if (total < CUSTOM_LIMITS.minRegimentStrength || total > CUSTOM_LIMITS.maxRegimentStrength) {
      fail(
        `Regiment "${id}" must field between ${CUSTOM_LIMITS.minRegimentStrength} and ` +
          `${CUSTOM_LIMITS.maxRegimentStrength} men; it fields ${total}.`,
      );
    }
    strength += total;
    if (strength > CUSTOM_LIMITS.maxArmyStrength) {
      fail(`${label} fields more than ${CUSTOM_LIMITS.maxArmyStrength} men in total.`, [
        'Cut a regiment, or reduce the counts in "troops".',
      ]);
    }

    const formation = regiment.formation ?? 'line';
    if (!(FORMATIONS as readonly string[]).includes(formation)) {
      fail(`"${id}.formation" must be one of: ${FORMATIONS.join(', ')}.`);
    }
    const stance = regiment.stance ?? 'defensive';
    if (!(STANCES as readonly string[]).includes(stance)) {
      fail(`"${id}.stance" must be one of: ${STANCES.join(', ')}.`);
    }

    if (regiment.carriesKing === true) {
      if (guardGroupId !== undefined) {
        fail(`Only one regiment per side carries its king; ${label} names two.`);
      }
      guardGroupId = id;
    }

    const placed = placedInZone.get(regiment.zone) ?? 0;
    placedInZone.set(regiment.zone, placed + 1);

    groups.push({
      id,
      name,
      ownerId,
      anchor: anchorInZone(map, regiment.zone, placed),
      formation: formation as Formation,
      stance: stance as Stance,
      composition,
    });
  }

  if (guardGroupId === undefined) {
    fail(`No regiment in ${label} carries a king.`, [
      'Set "carriesKing": true on the regiment the sovereign rides with.',
      'The king is the objective: a side without one cannot lose or be won against.',
    ]);
  }

  return { groups, guardGroupId, strength };
}

function parseScript(
  map: BattleMapDefinition,
  plan: readonly ScriptedAiOrder[] | undefined,
  enemyIds: ReadonlySet<string>,
): ScriptedAiOrder[] {
  if (plan === undefined) return [];
  if (!Array.isArray(plan)) fail('"enemyPlan" must be an array of scripted orders.');
  if (plan.length > CUSTOM_LIMITS.maxScriptedOrders) {
    fail(`"enemyPlan" may hold at most ${CUSTOM_LIMITS.maxScriptedOrders} orders.`);
  }

  const zoneIds = new Set<string>(map.zones.map((zone) => zone.id));
  const script: ScriptedAiOrder[] = [];

  for (const entry of plan) {
    if (typeof entry !== 'object' || entry === null) fail('"enemyPlan" holds a non-object.');
    if (
      typeof entry.atSeconds !== 'number' ||
      !Number.isFinite(entry.atSeconds) ||
      entry.atSeconds < 0 ||
      entry.atSeconds > CUSTOM_LIMITS.maxScriptSeconds
    ) {
      fail(`"atSeconds" must be between 0 and ${CUSTOM_LIMITS.maxScriptSeconds}.`);
    }
    if (!enemyIds.has(entry.groupId)) {
      fail(`The enemy plan orders "${entry.groupId}", which is not an enemy regiment.`, [
        `Enemy regiments: ${[...enemyIds].join(', ')}.`,
      ]);
    }
    if (!(SCRIPTABLE_ORDERS as readonly string[]).includes(entry.order)) {
      fail(`"${entry.order}" cannot be scripted.`, [
        `Scriptable orders: ${SCRIPTABLE_ORDERS.join(', ')}.`,
      ]);
    }
    const order = entry.order as ScriptableOrder;
    if (entry.targetZone !== undefined && !zoneIds.has(entry.targetZone)) {
      fail(`The enemy plan names "${entry.targetZone}", which is not on ${map.name}.`);
    }
    if (
      (ORDERS_NEEDING_GROUND as readonly string[]).includes(order) &&
      entry.targetZone === undefined
    ) {
      fail(`A "${order}" order needs a "targetZone".`);
    }
    if (entry.formation !== undefined && !(FORMATIONS as readonly string[]).includes(entry.formation)) {
      fail(`"formation" must be one of: ${FORMATIONS.join(', ')}.`);
    }
    if (entry.stance !== undefined && !(STANCES as readonly string[]).includes(entry.stance)) {
      fail(`"stance" must be one of: ${STANCES.join(', ')}.`);
    }

    script.push({
      atSeconds: Math.round(entry.atSeconds),
      groupId: entry.groupId,
      order,
      ...(entry.targetZone !== undefined ? { targetZone: entry.targetZone } : {}),
      ...(entry.formation !== undefined ? { formation: entry.formation } : {}),
      ...(entry.stance !== undefined ? { stance: entry.stance } : {}),
    });
  }

  // The commander reads his timetable in order, so it is sorted here once
  // rather than trusted to arrive sorted.
  script.sort((a, b) => a.atSeconds - b.atSeconds || a.groupId.localeCompare(b.groupId));
  return script;
}

function describeArmy(groups: readonly GroupSpec[], strength: number): string {
  return `${groups.length} regiments · ${strength.toLocaleString('en-GB')} men`;
}

/**
 * Turns a submitted design into an operation the engine can fight.
 *
 * Throws `CustomOperationError` — never a bare `Error` — for anything a caller
 * could have written differently, so the tool layer can hand back a reason and
 * a suggestion rather than a stack trace.
 */
export function buildCustomOperation(spec: CustomOperationSpec): ScenarioDefinition {
  if (typeof spec !== 'object' || spec === null) fail('A design must be an object.');
  const map = BATTLE_MAPS[spec.mapId];
  if (map === undefined) {
    fail(`"${String(spec.mapId)}" is not a battlefield.`, [
      `Battlefields: ${Object.keys(BATTLE_MAPS).join(', ')}.`,
    ]);
  }

  const name = checkText(spec.name, 'name', CUSTOM_LIMITS.maxNameLength);
  if (name === undefined) fail('An operation needs a name.');

  const player = parseSide(map, spec.playerRegiments, 'player');
  const enemy = parseSide(map, spec.enemyRegiments, 'enemy');

  // Group ids are one namespace for the whole battle — the roster, the tool
  // surface and the enemy's own timetable all address by id — so a name used on
  // both sides would make one of the two regiments unreachable.
  const claimed = new Set(player.groups.map((group) => group.id));
  for (const group of enemy.groups) {
    if (claimed.has(group.id)) {
      fail(`Regiment id "${group.id}" is used on both sides.`, [
        'Every regiment in a battle needs its own id — prefix them by side.',
      ]);
    }
  }
  const script = parseScript(map, spec.enemyPlan, new Set(enemy.groups.map((group) => group.id)));

  const summary =
    checkText(spec.summary, 'summary', CUSTOM_LIMITS.maxTextLength) ??
    `A designed operation on ${map.name}. ${map.terrainNote}`;
  const briefingLine =
    checkText(spec.briefingLine, 'briefingLine', CUSTOM_LIMITS.maxTextLength) ??
    `${map.name}: ${describeArmy(enemy.groups, enemy.strength)} against you.`;
  const twist =
    checkText(spec.twist, 'twist', CUSTOM_LIMITS.maxTextLength) ??
    'Designed at the War Council table.';
  const objective =
    checkText(spec.objective, 'objective', CUSTOM_LIMITS.maxTextLength) ??
    'Take the enemy sovereign, and keep your own.';

  const kingSpecs: readonly KingSpec[] = [
    {
      ownerId: 'player',
      name: checkText(spec.playerKingName, 'playerKingName', CUSTOM_LIMITS.maxNameLength) ??
        'King Aldric',
      guardGroupId: player.guardGroupId,
    },
    {
      ownerId: 'enemy',
      name: checkText(spec.enemyKingName, 'enemyKingName', CUSTOM_LIMITS.maxNameLength) ??
        'The Ashen King',
      guardGroupId: enemy.guardGroupId,
    },
  ];

  return {
    id: 'custom',
    mapId: map.id,
    numeral: 'M',
    name,
    location: map.name,
    summary,
    briefingLine,
    twist,
    objective,
    pressure: 'Designed',
    duration: script.length === 0 ? 'Unscripted' : `${script.length} scripted orders`,
    tags: [map.name, describeArmy(enemy.groups, enemy.strength), `${script.length} scripted orders`],
    battleOrders: [objective],
    battleFacts: [
      describeArmy(player.groups, player.strength),
      `${enemy.strength.toLocaleString('en-GB')} against you`,
      `${map.zones.length} named zones`,
    ],
    playerArmyName:
      checkText(spec.playerArmyName, 'playerArmyName', CUSTOM_LIMITS.maxNameLength) ?? 'Crownlands',
    enemyArmyName:
      checkText(spec.enemyArmyName, 'enemyArmyName', CUSTOM_LIMITS.maxNameLength) ?? 'Ashen Host',
    playerGroups: player.groups,
    enemyGroups: enemy.groups,
    kingSpecs,
    aiScript: script,
    origin: 'designed',
  };
}

/**
 * The operation waiting on the table when nobody has designed one.
 *
 * It is *generated from the map* rather than written, because the table's
 * ground is the commander's to choose: picking a battlefield at the War
 * Council lays a fresh skirmish on it, and a Marshal can do the same through
 * `select_operation`. Two matched armies of seven regiments, drawn up on the
 * ground each map actually offers, with a plain timetable for the enemy.
 *
 * The point of it is not to be a good battle. It is to be an honest blank one:
 * something a human can fight on any of the four battlefields with no agent
 * present, and something a Marshal can read, take apart and replace with a
 * better idea of its own.
 */

/** The battlefield the table is laid on until somebody chooses another. */
export const DEFAULT_TABLE_MAP: BattleMapId = 'river_vale';

/** Which half of a battlefield a zone belongs to. */
function sideOfZone(map: BattleMapDefinition, zone: ZoneDefinition): PlayerId {
  const middle =
    map.barrier === undefined ? MAP_HEIGHT / 2 : barrierCenterY(map.barrier, zone.center.x);
  return zone.center.y > middle ? 'player' : 'enemy';
}

/** How far a zone stands from the ground the two armies will meet on. */
function distanceToMiddle(map: BattleMapDefinition, zone: ZoneDefinition): number {
  const middle =
    map.barrier === undefined ? MAP_HEIGHT / 2 : barrierCenterY(map.barrier, zone.center.x);
  return Math.abs(zone.center.y - middle);
}

interface SidePlacement {
  home: ZoneId;
  centre: ZoneId;
  support: ZoneId;
  left: ZoneId;
  right: ZoneId;
}

/**
 * Picks the ground one side forms up on.
 *
 * Deliberately simple and wholly deterministic: the muster is the guard's, the
 * centre is the front-most central zone, and the wings are the western and
 * eastern extremes of what is left. Crossings are left empty, because a
 * regiment parked in a gap is a regiment that has already made the decision the
 * battle is supposed to pose.
 */
function placeSide(map: BattleMapDefinition, ownerId: PlayerId): SidePlacement {
  const home = ownerId === 'player' ? map.playerHomeZone : map.enemyHomeZone;
  const candidates = map.zones
    .filter((zone) => zone.id !== home && !zone.crossing && sideOfZone(map, zone) === ownerId)
    .sort(
      (a, b) => distanceToMiddle(map, a) - distanceToMiddle(map, b) || a.id.localeCompare(b.id),
    );

  const fallback = map.zones.find((zone) => zone.id === home) as ZoneDefinition;
  const front = candidates.length > 0 ? candidates : [fallback];
  const centre = front.find((zone) => zone.front === 'center') ?? (front[0] as ZoneDefinition);
  const rest = front.filter((zone) => zone.id !== centre.id);
  const byEast = [...rest].sort((a, b) => a.center.x - b.center.x || a.id.localeCompare(b.id));
  const left = byEast[0] ?? centre;
  const right = byEast[byEast.length - 1] ?? centre;
  const support =
    rest.find((zone) => zone.id !== left.id && zone.id !== right.id) ?? centre;

  return { home, centre: centre.id, support: support.id, left: left.id, right: right.id };
}

/** The seven regiments each side fields on the table, wherever it is laid. */
function skirmishArmy(
  prefix: string,
  label: string,
  placement: SidePlacement,
): CustomRegimentSpec[] {
  return [
    {
      id: `${prefix}_centre`,
      name: `${label} Centre`,
      zone: placement.centre,
      formation: 'line',
      stance: 'defensive',
      troops: [{ category: 'infantry', count: 600 }, { category: 'heavy_infantry', count: 180 }],
    },
    {
      id: `${prefix}_spears`,
      name: `${label} Spears`,
      zone: placement.centre,
      formation: 'double_line',
      stance: 'hold_ground',
      troops: [{ category: 'spearman', count: 360 }],
    },
    {
      id: `${prefix}_bows`,
      name: `${label} Bows`,
      zone: placement.support,
      formation: 'loose',
      stance: 'defensive',
      troops: [{ category: 'archer', count: 400 }],
    },
    {
      id: `${prefix}_left_horse`,
      name: `${label} Left Horse`,
      zone: placement.left,
      formation: 'wedge',
      stance: 'aggressive',
      troops: [{ category: 'cavalry', count: 260 }],
    },
    {
      id: `${prefix}_right_horse`,
      name: `${label} Right Horse`,
      zone: placement.right,
      formation: 'wedge',
      stance: 'aggressive',
      troops: [{ category: 'cavalry', count: 240 }],
    },
    {
      id: `${prefix}_train`,
      name: `${label} Train`,
      zone: placement.support,
      formation: 'loose',
      stance: 'hold_ground',
      troops: [{ category: 'siege', count: 36 }, { category: 'scout', count: 40 }],
    },
    {
      id: `${prefix}_guard`,
      name: `${label} Guard`,
      zone: placement.home,
      formation: 'square',
      stance: 'hold_ground',
      carriesKing: true,
      troops: [{ category: 'heavy_infantry', count: 240 }, { category: 'spearman', count: 120 }],
    },
  ];
}

/** A plain escalation: take the middle, go round both ends, then the camp. */
function skirmishPlan(crown: SidePlacement): ScriptedAiOrder[] {
  return [
    { atSeconds: 25, groupId: 'ashen_centre', order: 'attack_zone', targetZone: crown.centre, formation: 'line' },
    { atSeconds: 45, groupId: 'ashen_spears', order: 'move', targetZone: crown.centre, formation: 'double_line' },
    { atSeconds: 70, groupId: 'ashen_left_horse', order: 'attack_zone', targetZone: crown.left, formation: 'wedge', stance: 'aggressive' },
    { atSeconds: 95, groupId: 'ashen_right_horse', order: 'attack_zone', targetZone: crown.right, formation: 'wedge', stance: 'aggressive' },
    { atSeconds: 130, groupId: 'ashen_bows', order: 'move', targetZone: crown.centre, formation: 'loose' },
    { atSeconds: 180, groupId: 'ashen_centre', order: 'attack_zone', targetZone: crown.centre, formation: 'line', stance: 'aggressive' },
    { atSeconds: 240, groupId: 'ashen_train', order: 'attack_zone', targetZone: crown.centre, formation: 'loose', stance: 'hold_ground' },
    { atSeconds: 300, groupId: 'ashen_left_horse', order: 'attack_zone', targetZone: crown.home, formation: 'wedge', stance: 'aggressive' },
    { atSeconds: 380, groupId: 'ashen_spears', order: 'attack_zone', targetZone: crown.support, formation: 'double_line' },
    { atSeconds: 450, groupId: 'ashen_centre', order: 'attack_zone', targetZone: crown.home, formation: 'column', stance: 'aggressive' },
  ];
}

/** The blank operation for one battlefield, as a design a Marshal could have written. */
export function createSkirmishDraft(mapId: BattleMapId = DEFAULT_TABLE_MAP): CustomOperationSpec {
  const map = BATTLE_MAPS[mapId];
  if (map === undefined) {
    fail(`"${String(mapId)}" is not a battlefield.`, [
      `Battlefields: ${Object.keys(BATTLE_MAPS).join(', ')}.`,
    ]);
  }
  const crown = placeSide(map, 'player');
  const ashen = placeSide(map, 'enemy');

  return {
    name: 'Free Field',
    mapId: map.id,
    summary:
      `${map.summary} Two armies of the same weight, drawn up on the ground this map offers ` +
      'and nothing else. This is the blank operation the War Council keeps on the table: ' +
      'fight it as it stands, or have your Marshal write something better on this ground.',
    briefingLine: `${map.name}: two matched hosts. ${map.terrainNote}`,
    twist: 'Nothing here is authored. The table is yours, and your Marshal may rewrite it.',
    objective: 'Beat the Ashen host on this ground and take its king.',
    playerArmyName: 'Crownlands',
    enemyArmyName: 'Ashen Host',
    playerRegiments: skirmishArmy('crown', 'Crown', crown),
    enemyRegiments: skirmishArmy('ashen', 'Ashen', ashen),
    enemyPlan: skirmishPlan(crown),
  };
}

/** The default designed operation for one battlefield, built. */
export function createSkirmishOperation(mapId: BattleMapId = DEFAULT_TABLE_MAP): ScenarioDefinition {
  return buildCustomOperation(createSkirmishDraft(mapId));
}
