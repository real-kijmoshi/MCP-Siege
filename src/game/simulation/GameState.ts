import { FOG_COLUMNS, FOG_ROWS } from '../config/battle';
import type {
  ArmyGroup,
  BattleAlert,
  BattlePlan,
  CombatEvent,
  EnemyContact,
  PendingConditionalOrder,
  PlayerId,
} from '../types/domain';
import type { RandomState } from './Random';
import { UnitPool } from './UnitPool';

/** Three-state fog, one byte per cell: 0 unexplored, 1 explored, 2 visible. */
export interface VisibilityGrid {
  cells: Uint8Array;
}

export interface PlayerBattleState {
  id: PlayerId;
  name: string;
  /** Accrues over time and pays for reinforcement waves. */
  manpower: number;
  /** Waves banked and ready to deploy. */
  availableWaves: number;
  wavesDeployed: number;
}

export interface GameState {
  gameSeed: number;
  random: RandomState;
  currentTick: number;
  commandSequence: number;
  entitySequence: number;

  units: UnitPool;
  /** Indexed by group slot; units store the slot in `UnitPool.group`. */
  groups: ArmyGroup[];
  groupIndexById: Map<string, number>;

  players: Record<PlayerId, PlayerBattleState>;
  visibility: Record<PlayerId, VisibilityGrid>;
  /** What each side remembers about the other. Keyed by enemy group id. */
  contacts: Record<PlayerId, Map<string, EnemyContact>>;
  /** Which side currently holds each zone, by zone id. */
  zoneControl: Map<string, PlayerId | undefined>;
  /** Previous controller per zone, so only genuine changes raise an alert. */
  zoneControlPrevious: Map<string, PlayerId | undefined>;

  plans: BattlePlan[];
  conditionals: PendingConditionalOrder[];
  /** Ids of plan steps that have already fired, backing `after_step`. */
  completedSteps: Set<string>;

  alerts: BattleAlert[];
  /** Alert key to the tick it may next fire, preventing spam. */
  alertCooldowns: Map<string, number>;

  /** Cosmetic, bounded, render-only. Excluded from the determinism checksum. */
  combatEvents: CombatEvent[];
}

function createVisibilityGrid(): VisibilityGrid {
  return { cells: new Uint8Array(FOG_COLUMNS * FOG_ROWS) };
}

export function createEmptyState(seed: number): GameState {
  return {
    gameSeed: seed,
    random: { value: seed >>> 0 || 1 },
    currentTick: 0,
    commandSequence: 1,
    entitySequence: 1,

    units: new UnitPool(),
    groups: [],
    groupIndexById: new Map(),

    players: {
      player: { id: 'player', name: 'Crownlands', manpower: 0, availableWaves: 0, wavesDeployed: 0 },
      enemy: { id: 'enemy', name: 'Ashen Host', manpower: 0, availableWaves: 0, wavesDeployed: 0 },
    },
    visibility: {
      player: createVisibilityGrid(),
      enemy: createVisibilityGrid(),
    },
    contacts: {
      player: new Map(),
      enemy: new Map(),
    },
    zoneControl: new Map(),
    zoneControlPrevious: new Map(),

    plans: [],
    conditionals: [],
    completedSteps: new Set(),

    alerts: [],
    alertCooldowns: new Map(),

    combatEvents: [],
  };
}

/* ----------------------------------------------------------------- helpers */

export function findGroup(state: GameState, groupId: string): ArmyGroup | undefined {
  const index = state.groupIndexById.get(groupId);
  return index === undefined ? undefined : state.groups[index];
}

export function groupSlotOf(state: GameState, groupId: string): number {
  return state.groupIndexById.get(groupId) ?? -1;
}

export function registerGroup(state: GameState, group: ArmyGroup): number {
  const slot = state.groups.length;
  state.groups.push(group);
  state.groupIndexById.set(group.id, slot);
  return slot;
}

/** Live groups only. Empty groups linger as slots so unit indices stay stable. */
export function activeGroups(state: GameState, ownerId?: PlayerId): ArmyGroup[] {
  return state.groups.filter(
    (group) => group.members.length > 0 && (ownerId === undefined || group.ownerId === ownerId),
  );
}

export function nextEntityId(state: GameState, prefix: string): string {
  const id = `${prefix}_${state.entitySequence}`;
  state.entitySequence += 1;
  return id;
}

/**
 * Order-independent checksum of everything the simulation mutates. Determinism
 * tests compare this across identical runs.
 */
export function stateChecksum(state: GameState): number {
  let hash = state.units.checksum();
  const mix = (value: number): void => {
    hash ^= value | 0;
    hash = Math.imul(hash, 16_777_619) >>> 0;
  };
  mix(state.currentTick);
  mix(state.random.value);
  mix(state.commandSequence);
  for (const group of state.groups) {
    mix(group.members.length);
    mix(Math.round(group.morale * 100));
    mix(Math.round(group.anchor.x * 16));
    mix(Math.round(group.anchor.y * 16));
    mix(Math.round(group.facing * 1000));
    mix(group.path.length);
    mix(group.order.kind.length * 31 + group.formation.length);
  }
  for (const playerId of ['player', 'enemy'] as const) {
    mix(Math.round(state.players[playerId].manpower));
    mix(state.contacts[playerId].size);
  }
  mix(state.conditionals.length);
  mix(state.alerts.length);
  return hash >>> 0;
}
