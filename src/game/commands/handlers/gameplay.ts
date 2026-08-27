import {
  BUILDINGS, PRODUCTION, UNITS, UPGRADES, WORLD_HEIGHT, WORLD_WIDTH,
  hasResources, spendResources,
} from '../../config/gameplay';
import type { GameState } from '../../simulation/GameState';
import { checkBuildingPlacement } from '../../simulation/Placement';
import type { FormationType, UnitState, Vector2D } from '../../types/domain';
import type { CommandResult, GameCommand } from '../types';
import { failure, nextEntityId } from './shared';

function ownedVillagers(state: GameState, ownerId: string, ids: string[]) {
  const unique = [...new Set(ids)].sort();
  const villagers = unique.map((id) => state.villagers[id]);
  if (unique.length === 0 || villagers.some((worker) => worker === undefined || worker.ownerId !== ownerId)) return undefined;
  return villagers.filter((worker) => worker !== undefined);
}

export function handleGatherResource(command: GameCommand, state: GameState): CommandResult {
  if (command.type !== 'gather_resource') return failure(command, state, 'UNSUPPORTED_COMMAND', 'Unsupported command.');
  const workers = ownedVillagers(state, command.playerId, command.villagerIds);
  const node = state.resourceNodes[command.resourceNodeId];
  if (workers === undefined) return failure(command, state, 'WORKER_NOT_OWNED', 'Select one or more friendly villagers.');
  if (node === undefined || node.remaining <= 0) return failure(command, state, 'RESOURCE_UNAVAILABLE', 'That resource deposit is depleted or unavailable.');
  for (const worker of workers) {
    worker.job = 'moving';
    worker.order = { kind: 'gather', targetId: node.id, targetPosition: { ...node.position } };
  }
  return {
    ok: true, commandId: command.id, appliedAtTick: state.currentTick,
    summary: `${workers.length} villager${workers.length === 1 ? '' : 's'} gathering ${node.type}.`,
    affectedEntities: workers.map((worker) => worker.id),
    data: { resourceType: node.type, warnings: [] },
  };
}

export function handlePlaceBuilding(command: GameCommand, state: GameState): CommandResult {
  if (command.type !== 'place_building') return failure(command, state, 'UNSUPPORTED_COMMAND', 'Unsupported command.');
  const player = state.players[command.playerId];
  const workers = ownedVillagers(state, command.playerId, command.workerIds);
  const definition = BUILDINGS[command.buildingType];
  if (player === undefined) return failure(command, state, 'PLAYER_NOT_FOUND', 'Player is unavailable.');
  if (workers === undefined) return failure(command, state, 'WORKER_NOT_OWNED', 'Construction requires friendly villagers.');
  if (command.buildingType === 'town_hall') return failure(command, state, 'UNAVAILABLE_BUILDING', 'Additional Town Halls are outside this prototype.');
  const placement = checkBuildingPlacement(state, command.buildingType, command.position);
  if (!placement.valid) return failure(command, state, placement.code ?? 'INVALID_PLACEMENT', placement.message);
  if (!hasResources(player.resources, definition.cost)) {
    return failure(command, state, 'INSUFFICIENT_RESOURCES', `Not enough resources to build ${definition.label}.`, ['Gather more resources and retry.']);
  }
  spendResources(player.resources, definition.cost);
  const id = nextEntityId(state, `building_${command.playerId === 'enemy_kingdom' ? 'enemy' : 'player'}_${command.buildingType}`);
  state.buildings[id] = {
    id, ownerId: command.playerId, type: command.buildingType, position: { ...command.position },
    status: 'blueprint', constructionProgress: 0, constructionRequired: definition.buildTicks,
    hitPoints: Math.max(1, Math.round(definition.hitPoints * 0.1)), maxHitPoints: definition.hitPoints,
    productionQueue: [],
  };
  for (const worker of workers) {
    worker.job = 'moving';
    worker.order = { kind: 'build', targetId: id, targetPosition: { ...command.position } };
  }
  return {
    ok: true, commandId: command.id, appliedAtTick: state.currentTick,
    summary: `${definition.label} blueprint placed; ${workers.length} villager${workers.length === 1 ? '' : 's'} assigned.`,
    affectedEntities: [id, ...workers.map((worker) => worker.id)],
    data: { buildingId: id, warnings: [] },
  };
}

export function handleTrainUnit(command: GameCommand, state: GameState): CommandResult {
  if (command.type !== 'train_unit') return failure(command, state, 'UNSUPPORTED_COMMAND', 'Unsupported command.');
  const player = state.players[command.playerId];
  const building = state.buildings[command.buildingId];
  const definition = UNITS[command.unitType];
  if (player === undefined) return failure(command, state, 'PLAYER_NOT_FOUND', 'Player is unavailable.');
  if (building === undefined || building.ownerId !== command.playerId) return failure(command, state, 'BUILDING_NOT_OWNED', 'Select a friendly production building.');
  if (building.status !== 'complete') return failure(command, state, 'BUILDING_INCOMPLETE', 'The building must be completed first.');
  if (!(PRODUCTION[building.type] ?? []).includes(command.unitType)) return failure(command, state, 'UNIT_UNAVAILABLE', `${building.type} cannot produce ${command.unitType}.`);
  const queuedPopulation = Object.values(state.buildings)
    .filter((item) => item.ownerId === command.playerId)
    .flatMap((item) => item.productionQueue)
    .reduce((sum, item) => sum + UNITS[item.unitType].population, 0);
  if (player.population + queuedPopulation + definition.population > player.populationCap) {
    return failure(command, state, 'POPULATION_CAP', `Population cap reached (${player.population} / ${player.populationCap}). Build a House.`, ['Construct a House before training more units.']);
  }
  if (building.productionQueue.length >= 5) return failure(command, state, 'QUEUE_FULL', 'This production queue is full.');
  if (!hasResources(player.resources, definition.cost)) return failure(command, state, 'INSUFFICIENT_RESOURCES', `Not enough resources to train ${definition.label}.`);
  spendResources(player.resources, definition.cost);
  const orderId = nextEntityId(state, 'production');
  building.productionQueue.push({ id: orderId, unitType: command.unitType, remainingTicks: definition.trainTicks, totalTicks: definition.trainTicks });
  return {
    ok: true, commandId: command.id, appliedAtTick: state.currentTick,
    summary: `${definition.label} added to ${BUILDINGS[building.type].label} queue (${building.productionQueue.length}/5).`,
    affectedEntities: [building.id],
    data: { unitType: command.unitType, queueLength: building.productionQueue.length, warnings: [] },
  };
}

export function handleResearchUpgrade(command: GameCommand, state: GameState): CommandResult {
  if (command.type !== 'research_upgrade') return failure(command, state, 'UNSUPPORTED_COMMAND', 'Unsupported command.');
  const player = state.players[command.playerId];
  const building = state.buildings[command.buildingId];
  const upgrade = UPGRADES[command.upgradeType];
  if (player === undefined || building === undefined || building.ownerId !== command.playerId || building.type !== 'armoury' || building.status !== 'complete') {
    return failure(command, state, 'ARMOURY_REQUIRED', 'Select a completed friendly Armoury.');
  }
  if (player.completedUpgrades.includes(command.upgradeType)) return failure(command, state, 'ALREADY_RESEARCHED', `${upgrade.label} is already researched.`);
  if (!hasResources(player.resources, upgrade.cost)) return failure(command, state, 'INSUFFICIENT_RESOURCES', `Not enough resources for ${upgrade.label}.`);
  spendResources(player.resources, upgrade.cost);
  player.completedUpgrades.push(command.upgradeType);
  player.completedUpgrades.sort();
  return {
    ok: true, commandId: command.id, appliedAtTick: state.currentTick,
    summary: `${upgrade.label} researched.`, affectedEntities: [building.id],
    data: { upgradeType: command.upgradeType, warnings: [] },
  };
}

export function handleAttackTarget(command: GameCommand, state: GameState): CommandResult {
  if (command.type !== 'attack_target') return failure(command, state, 'UNSUPPORTED_COMMAND', 'Unsupported command.');
  const ids = [...new Set(command.unitIds)].sort();
  const attackers = ids.map((id) => state.units[id]);
  const target = state.units[command.targetId] ?? state.buildings[command.targetId];
  if (ids.length === 0 || attackers.some((unit) => unit === undefined || unit.ownerId !== command.playerId)) return failure(command, state, 'UNIT_NOT_OWNED', 'Select friendly units.');
  if (target === undefined || target.ownerId === command.playerId) return failure(command, state, 'INVALID_TARGET', 'Choose an enemy unit or structure.');
  for (const attacker of attackers) if (attacker !== undefined) {
    attacker.order = { kind: 'attack', targetId: command.targetId, targetPosition: { ...target.position } };
    const villager = state.villagers[attacker.id];
    if (villager !== undefined) villager.job = 'moving';
  }
  return {
    ok: true, commandId: command.id, appliedAtTick: state.currentTick,
    summary: `${ids.length} unit${ids.length === 1 ? '' : 's'} attacking the selected enemy.`,
    affectedEntities: [...ids, command.targetId], data: { warnings: [] },
  };
}

export function handleAssistBuilding(command: GameCommand, state: GameState): CommandResult {
  if (command.type !== 'assist_building') return failure(command, state, 'UNSUPPORTED_COMMAND', 'Unsupported command.');
  const workers = ownedVillagers(state, command.playerId, command.villagerIds);
  const building = state.buildings[command.buildingId];
  if (workers === undefined) return failure(command, state, 'WORKER_NOT_OWNED', 'Select one or more friendly villagers.');
  if (building === undefined || building.ownerId !== command.playerId || building.status !== 'blueprint') {
    return failure(command, state, 'INVALID_CONSTRUCTION', 'Choose a friendly construction site.');
  }
  for (const worker of workers) {
    worker.job = 'moving';
    worker.order = { kind: 'build', targetId: building.id, targetPosition: { ...building.position } };
  }
  return {
    ok: true, commandId: command.id, appliedAtTick: state.currentTick,
    summary: `${workers.length} villager${workers.length === 1 ? '' : 's'} assisting ${BUILDINGS[building.type].label}.`,
    affectedEntities: [...workers.map((worker) => worker.id), building.id], data: { buildingId: building.id, warnings: [] },
  };
}

export function handleRepairBuilding(command: GameCommand, state: GameState): CommandResult {
  if (command.type !== 'repair_building') return failure(command, state, 'UNSUPPORTED_COMMAND', 'Unsupported command.');
  const workers = ownedVillagers(state, command.playerId, command.villagerIds);
  const building = state.buildings[command.buildingId];
  if (workers === undefined) return failure(command, state, 'WORKER_NOT_OWNED', 'Select one or more friendly villagers.');
  if (building === undefined || building.ownerId !== command.playerId || building.status !== 'complete') {
    return failure(command, state, 'INVALID_REPAIR_TARGET', 'Choose a completed friendly structure.');
  }
  if (building.hitPoints >= building.maxHitPoints) return failure(command, state, 'REPAIR_NOT_NEEDED', 'That structure is already at full health.');
  for (const worker of workers) {
    worker.job = 'moving';
    worker.order = { kind: 'repair', targetId: building.id, targetPosition: { ...building.position } };
  }
  return {
    ok: true, commandId: command.id, appliedAtTick: state.currentTick,
    summary: `${workers.length} villager${workers.length === 1 ? '' : 's'} repairing ${BUILDINGS[building.type].label}.`,
    affectedEntities: [...workers.map((worker) => worker.id), building.id], data: { buildingId: building.id, warnings: [] },
  };
}

export function handleCancelProduction(command: GameCommand, state: GameState): CommandResult {
  if (command.type !== 'cancel_production') return failure(command, state, 'UNSUPPORTED_COMMAND', 'Unsupported command.');
  const building = state.buildings[command.buildingId];
  const player = state.players[command.playerId];
  if (building === undefined || building.ownerId !== command.playerId || player === undefined) {
    return failure(command, state, 'BUILDING_NOT_OWNED', 'Choose a friendly production building.');
  }
  const index = building.productionQueue.findIndex((order) => order.id === command.orderId);
  if (index < 0) return failure(command, state, 'ORDER_NOT_FOUND', 'That production order is no longer queued.');
  const [cancelled] = building.productionQueue.splice(index, 1);
  if (cancelled === undefined) return failure(command, state, 'ORDER_NOT_FOUND', 'That production order is no longer queued.');
  for (const [resource, amount] of Object.entries(UNITS[cancelled.unitType].cost)) {
    player.resources[resource as keyof typeof player.resources] += Math.floor((amount ?? 0) * 0.5);
  }
  return {
    ok: true, commandId: command.id, appliedAtTick: state.currentTick,
    summary: `${UNITS[cancelled.unitType].label} cancelled; 50% of its cost was refunded.`,
    affectedEntities: [building.id], data: { unitType: cancelled.unitType, queueLength: building.productionQueue.length, warnings: [] },
  };
}

export function handleSetRallyPoint(command: GameCommand, state: GameState): CommandResult {
  if (command.type !== 'set_rally_point') return failure(command, state, 'UNSUPPORTED_COMMAND', 'Unsupported command.');
  const building = state.buildings[command.buildingId];
  if (building === undefined || building.ownerId !== command.playerId || building.status !== 'complete') {
    return failure(command, state, 'BUILDING_NOT_OWNED', 'Choose a completed friendly production building.');
  }
  if (!Number.isFinite(command.position.x) || !Number.isFinite(command.position.y) || command.position.x < 0 ||
      command.position.x > WORLD_WIDTH || command.position.y < 0 || command.position.y > WORLD_HEIGHT) {
    return failure(command, state, 'INVALID_DESTINATION', 'The rally point is outside the battlefield.');
  }
  building.rallyPoint = { ...command.position };
  return {
    ok: true, commandId: command.id, appliedAtTick: state.currentTick,
    summary: `${BUILDINGS[building.type].label} rally point updated.`, affectedEntities: [building.id],
    data: { destination: { ...command.position }, warnings: [] },
  };
}

function formationOffset(index: number, count: number, formation: FormationType): Vector2D {
  if (formation === 'line') return { x: (index - (count - 1) / 2) * 28, y: 0 };
  if (formation === 'column') return { x: 0, y: index * 27 };
  if (formation === 'wedge') {
    if (index === 0) return { x: 0, y: 0 };
    const rank = Math.ceil(index / 2); return { x: (index % 2 === 0 ? 1 : -1) * rank * 25, y: rank * 23 };
  }
  const columns = Math.ceil(Math.sqrt(count));
  const spacing = formation === 'loose' ? 42 : 27;
  return { x: (index % columns - (columns - 1) / 2) * spacing, y: Math.floor(index / columns) * spacing };
}

export function handleIssueUnitOrder(command: GameCommand, state: GameState): CommandResult {
  if (command.type !== 'issue_unit_order') return failure(command, state, 'UNSUPPORTED_COMMAND', 'Unsupported command.');
  const ids = [...new Set(command.unitIds)].sort();
  const units = ids.map((id) => state.units[id]);
  if (ids.length === 0 || ids.length > 200 || units.some((unit) => unit === undefined || unit.ownerId !== command.playerId)) {
    return failure(command, state, 'UNIT_NOT_OWNED', 'Select between 1 and 200 friendly units.');
  }
  const resolved = units.filter((unit): unit is UnitState => unit !== undefined);
  if (command.order === 'set_formation') {
    if (command.formation === undefined) return failure(command, state, 'FORMATION_REQUIRED', 'Choose a formation.');
    for (const unit of resolved) unit.formation = command.formation;
    return { ok: true, commandId: command.id, appliedAtTick: state.currentTick, summary: `${resolved.length} units adopting ${command.formation} formation.`, affectedEntities: ids, data: { warnings: [] } };
  }
  if (command.order === 'set_stance') {
    if (command.stance === undefined) return failure(command, state, 'STANCE_REQUIRED', 'Choose a combat stance.');
    for (const unit of resolved) unit.stance = command.stance;
    return { ok: true, commandId: command.id, appliedAtTick: state.currentTick, summary: `${resolved.length} units set to ${command.stance.replace('_', ' ')}.`, affectedEntities: ids, data: { warnings: [] } };
  }
  if (command.order === 'stop' || command.order === 'hold_position') {
    for (const unit of resolved) {
      if (command.order === 'stop') delete unit.order;
      else { unit.order = { kind: 'hold', targetPosition: { ...unit.position } }; unit.stance = 'hold_ground'; }
      const worker = state.villagers[unit.id]; if (worker !== undefined) worker.job = 'idle';
    }
  } else {
    const destination = command.destination;
    if (destination === undefined || !Number.isFinite(destination.x) || !Number.isFinite(destination.y) ||
        destination.x < 0 || destination.x > WORLD_WIDTH || destination.y < 0 || destination.y > WORLD_HEIGHT) {
      return failure(command, state, 'INVALID_DESTINATION', 'Choose a destination inside the battlefield.');
    }
    const formation = command.formation ?? resolved[0]?.formation ?? 'square';
    const kind = command.order === 'attack_move' ? 'attack_move' : command.order === 'defend_area' ? 'defend' : 'retreat';
    resolved.forEach((unit, index) => {
      const offset = formationOffset(index, resolved.length, formation);
      unit.formation = formation;
      unit.order = { kind, targetPosition: { x: destination.x + offset.x, y: destination.y + offset.y } };
      if (kind === 'defend') unit.stance = 'defensive';
      const worker = state.villagers[unit.id]; if (worker !== undefined) worker.job = 'moving';
    });
  }
  const data = command.destination === undefined
    ? { warnings: [] }
    : { destination: { ...command.destination }, warnings: [] };
  return {
    ok: true, commandId: command.id, appliedAtTick: state.currentTick,
    summary: `${resolved.length} unit${resolved.length === 1 ? '' : 's'} received ${command.order.replace('_', ' ')} orders.`,
    affectedEntities: ids, data,
  };
}
