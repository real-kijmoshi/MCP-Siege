import {
  BUILDINGS, PRODUCTION, UNITS, UPGRADES, WORLD_HEIGHT, WORLD_WIDTH,
  hasResources, spendResources,
} from '../../config/gameplay';
import type { GameState } from '../../simulation/GameState';
import { RESOURCE_TYPES } from '../../types/domain';
import type { CommandResult, GameCommand } from '../types';
import { distance, failure, nextEntityId } from './shared';

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
  if (command.position.x < 50 || command.position.x > WORLD_WIDTH - 50 || command.position.y < 50 || command.position.y > WORLD_HEIGHT - 80) {
    return failure(command, state, 'INVALID_PLACEMENT', 'Place the blueprint inside the buildable battlefield.');
  }
  const collision = Object.values(state.buildings).some((building) =>
    distance(building.position, command.position) < BUILDINGS[building.type].footprint + definition.footprint);
  const blockedNode = Object.values(state.resourceNodes).some((node) =>
    node.remaining > 0 && distance(node.position, command.position) < definition.footprint + 55);
  if (collision || blockedNode) return failure(command, state, 'PLACEMENT_BLOCKED', 'That blueprint overlaps a structure or resource site.');
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
