import type {
  BuildingType, CombatStance, FormationType, MilitaryOrderType, ResourceType, UnitType, UpgradeType, Vector2D, WorkerAssignments,
} from '../types/domain';

export type CommandSource = 'human' | 'webmcp' | 'enemy_ai' | 'debug';
export interface CommandContext { source: CommandSource; issuedAtTick: number; sequence: number }
export interface AssignWorkersPayload { type: 'assign_workers'; playerId: string; assignments: WorkerAssignments }
export interface MoveUnitsPayload { type: 'move_units'; playerId: string; unitIds: string[]; destination: Vector2D }
export interface GatherResourcePayload { type: 'gather_resource'; playerId: string; villagerIds: string[]; resourceNodeId: string }
export interface PlaceBuildingPayload { type: 'place_building'; playerId: string; workerIds: string[]; buildingType: BuildingType; position: Vector2D }
export interface TrainUnitPayload { type: 'train_unit'; playerId: string; buildingId: string; unitType: UnitType }
export interface ResearchUpgradePayload { type: 'research_upgrade'; playerId: string; buildingId: string; upgradeType: UpgradeType }
export interface AttackTargetPayload { type: 'attack_target'; playerId: string; unitIds: string[]; targetId: string }
export interface AssistBuildingPayload { type: 'assist_building'; playerId: string; villagerIds: string[]; buildingId: string }
export interface RepairBuildingPayload { type: 'repair_building'; playerId: string; villagerIds: string[]; buildingId: string }
export interface CancelProductionPayload { type: 'cancel_production'; playerId: string; buildingId: string; orderId: string }
export interface SetRallyPointPayload { type: 'set_rally_point'; playerId: string; buildingId: string; position: Vector2D }
export interface IssueUnitOrderPayload {
  type: 'issue_unit_order'; playerId: string; unitIds: string[]; order: MilitaryOrderType;
  destination?: Vector2D; formation?: FormationType; stance?: CombatStance;
}

export type GameCommandPayload =
  | AssignWorkersPayload | MoveUnitsPayload | GatherResourcePayload | PlaceBuildingPayload
  | TrainUnitPayload | ResearchUpgradePayload | AttackTargetPayload | AssistBuildingPayload
  | RepairBuildingPayload | CancelProductionPayload | SetRallyPointPayload | IssueUnitOrderPayload;
export type GameCommand = GameCommandPayload & CommandContext & { id: string };

export interface CommandResultData {
  warnings: string[];
  assignments?: WorkerAssignments;
  idleWorkers?: number;
  destination?: Vector2D;
  movedUnits?: string[];
  resourceType?: ResourceType;
  buildingId?: string;
  unitType?: UnitType;
  queueLength?: number;
  upgradeType?: UpgradeType;
}
export interface CommandSuccess {
  ok: true; commandId: string; appliedAtTick: number; summary: string;
  affectedEntities: string[]; data: CommandResultData;
}
export interface CommandFailure {
  ok: false; commandId: string; appliedAtTick: number; code: string;
  message: string; suggestions: string[];
}
export type CommandResult = CommandSuccess | CommandFailure;
export interface CommandLogEntry { command: GameCommand; result: CommandResult }
