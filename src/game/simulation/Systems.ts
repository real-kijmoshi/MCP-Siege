import { BUILDINGS, GATHER_PER_TICK, TICKS_PER_SECOND, UNITS } from '../config/gameplay';
import type { GameCommandPayload } from '../commands/types';
import type { BuildingState, UnitState } from '../types/domain';
import type { GameState } from './GameState';

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function moveToward(unit: UnitState, target: { x: number; y: number }, stopDistance: number): boolean {
  const dx = target.x - unit.position.x;
  const dy = target.y - unit.position.y;
  const length = Math.hypot(dx, dy);
  if (length <= stopDistance + 0.1) return true;
  const step = Math.min(UNITS[unit.type].speed, length - stopDistance);
  unit.position.x += (dx / length) * step;
  unit.position.y += (dy / length) * step;
  return false;
}

export function advanceMovement(state: GameState): void {
  for (const unit of Object.values(state.units).sort((a, b) => a.id.localeCompare(b.id))) {
    if (unit.attackCooldown > 0) unit.attackCooldown -= 1;
    const order = unit.order;
    if (order === undefined) continue;
    if (order.kind === 'move') {
      if (moveToward(unit, order.targetPosition, 2)) {
        delete unit.order;
        const worker = state.villagers[unit.id];
        if (worker !== undefined) worker.job = 'idle';
      }
      continue;
    }
    if (order.kind === 'gather') {
      const node = order.targetId === undefined ? undefined : state.resourceNodes[order.targetId];
      if (node === undefined || node.remaining <= 0) {
        delete unit.order;
        const worker = state.villagers[unit.id];
        if (worker !== undefined) worker.job = 'idle';
        continue;
      }
      order.targetPosition = { ...node.position };
      const arrived = moveToward(unit, node.position, 42);
      const worker = state.villagers[unit.id];
      if (worker !== undefined) worker.job = arrived ? 'gathering' : 'moving';
      continue;
    }
    if (order.kind === 'build') {
      const building = order.targetId === undefined ? undefined : state.buildings[order.targetId];
      if (building === undefined || building.status === 'complete') {
        delete unit.order;
        const worker = state.villagers[unit.id];
        if (worker !== undefined) worker.job = 'idle';
        continue;
      }
      order.targetPosition = { ...building.position };
      const arrived = moveToward(unit, building.position, BUILDINGS[building.type].footprint + 16);
      const worker = state.villagers[unit.id];
      if (worker !== undefined) worker.job = arrived ? 'building' : 'moving';
      continue;
    }
    if (order.kind === 'attack') {
      const target = order.targetId === undefined ? undefined : state.units[order.targetId] ?? state.buildings[order.targetId];
      if (target === undefined || target.hitPoints <= 0 || target.ownerId === unit.ownerId) {
        delete unit.order;
        continue;
      }
      order.targetPosition = { ...target.position };
      moveToward(unit, target.position, UNITS[unit.type].range);
    }
  }
}

export function advanceGathering(state: GameState): void {
  for (const worker of Object.values(state.villagers).sort((a, b) => a.id.localeCompare(b.id))) {
    if (worker.job !== 'gathering' || worker.order?.kind !== 'gather' || worker.order.targetId === undefined) continue;
    const node = state.resourceNodes[worker.order.targetId];
    const player = state.players[worker.ownerId];
    if (node === undefined || player === undefined || node.remaining <= 0 || distance(worker.position, node.position) > 50) continue;
    const storehouseBonus = Object.values(state.buildings).some((building) =>
      building.ownerId === worker.ownerId && building.type === 'storehouse' && building.status === 'complete' &&
      distance(building.position, node.position) <= 180) ? 1.2 : 1;
    const amount = Math.min(node.remaining, GATHER_PER_TICK[node.type] * storehouseBonus);
    node.remaining -= amount;
    player.resources[node.type] += amount;
  }
}

export function advanceConstruction(state: GameState): void {
  for (const building of Object.values(state.buildings).sort((a, b) => a.id.localeCompare(b.id))) {
    if (building.status !== 'blueprint') continue;
    const builders = Object.values(state.villagers).filter((worker) =>
      worker.order?.kind === 'build' && worker.order.targetId === building.id &&
      worker.job === 'building' && distance(worker.position, building.position) <= BUILDINGS[building.type].footprint + 22);
    if (builders.length === 0) continue;
    building.constructionProgress += Math.sqrt(builders.length);
    building.hitPoints = Math.min(
      building.maxHitPoints,
      Math.max(1, Math.round(building.maxHitPoints * building.constructionProgress / building.constructionRequired)),
    );
    if (building.constructionProgress < building.constructionRequired) continue;
    building.constructionProgress = building.constructionRequired;
    building.status = 'complete';
    building.hitPoints = building.maxHitPoints;
    const player = state.players[building.ownerId];
    if (player !== undefined) player.populationCap += BUILDINGS[building.type].populationCap;
    for (const builder of builders) {
      builder.job = 'idle';
      delete builder.order;
    }
  }
}

function spawnUnit(state: GameState, building: BuildingState, type: UnitState['type']): void {
  const number = state.entitySequence++;
  const side = building.ownerId === 'enemy_kingdom' ? 'enemy' : 'player';
  const id = `unit_${side}_${type}_${String(number).padStart(4, '0')}`;
  const definition = UNITS[type];
  const unit: UnitState = {
    id, ownerId: building.ownerId, type,
    position: { x: building.position.x + BUILDINGS[building.type].footprint + 28, y: building.position.y + 20 },
    hitPoints: definition.hitPoints, maxHitPoints: definition.hitPoints, attackCooldown: 0,
  };
  state.units[id] = unit;
  if (type === 'villager') {
    const villager = { ...unit, type: 'villager' as const, job: 'idle' as const };
    state.units[id] = villager;
    state.villagers[id] = villager;
  }
  const player = state.players[building.ownerId];
  if (player !== undefined) player.population += definition.population;
}

export function advanceProduction(state: GameState): void {
  for (const building of Object.values(state.buildings).sort((a, b) => a.id.localeCompare(b.id))) {
    if (building.status !== 'complete') continue;
    const order = building.productionQueue[0];
    if (order === undefined) continue;
    order.remainingTicks -= 1;
    if (order.remainingTicks > 0) continue;
    building.productionQueue.shift();
    spawnUnit(state, building, order.unitType);
  }
}

function damageFor(state: GameState, unit: UnitState): number {
  const upgrades = state.players[unit.ownerId]?.completedUpgrades ?? [];
  let damage = UNITS[unit.type].damage;
  if ((unit.type === 'swordsman' || unit.type === 'spearman') && upgrades.includes('infantry_weapons_1')) damage += 3;
  if (unit.type === 'archer' && upgrades.includes('archer_damage_1')) damage += 3;
  return damage;
}

function armorFor(state: GameState, target: UnitState): number {
  const upgrades = state.players[target.ownerId]?.completedUpgrades ?? [];
  if ((target.type === 'swordsman' || target.type === 'spearman') && upgrades.includes('infantry_armor_1')) return 3;
  if (target.type === 'knight' && upgrades.includes('cavalry_armor_1')) return 4;
  return 0;
}

function nearestEnemy(state: GameState, ownerId: string, position: { x: number; y: number }, radius: number) {
  return [...Object.values(state.units), ...Object.values(state.buildings)]
    .filter((entity) => entity.ownerId !== ownerId && entity.hitPoints > 0 && distance(entity.position, position) <= radius)
    .sort((a, b) => distance(a.position, position) - distance(b.position, position) || a.id.localeCompare(b.id))[0];
}

export function advanceCombat(state: GameState): void {
  for (const unit of Object.values(state.units).sort((a, b) => a.id.localeCompare(b.id))) {
    if (unit.type === 'villager' && unit.order?.kind !== 'attack') continue;
    let target = unit.order?.kind === 'attack' && unit.order.targetId !== undefined
      ? state.units[unit.order.targetId] ?? state.buildings[unit.order.targetId] : undefined;
    target ??= nearestEnemy(state, unit.ownerId, unit.position, 145);
    if (target === undefined || distance(unit.position, target.position) > UNITS[unit.type].range || unit.attackCooldown > 0) continue;
    const armor = 'type' in target && target.id in state.units ? armorFor(state, target as UnitState) : 0;
    target.hitPoints -= Math.max(1, damageFor(state, unit) - armor);
    unit.attackCooldown = TICKS_PER_SECOND;
  }
  for (const tower of Object.values(state.buildings).filter((building) => building.type === 'watch_tower' && building.status === 'complete')) {
    if (state.currentTick % 20 !== 0) continue;
    const target = nearestEnemy(state, tower.ownerId, tower.position, 190);
    if (target !== undefined) target.hitPoints -= 14;
  }
  for (const unit of Object.values(state.units).filter((entity) => entity.hitPoints <= 0)) {
    const player = state.players[unit.ownerId];
    if (player !== undefined) player.population = Math.max(0, player.population - UNITS[unit.type].population);
    delete state.units[unit.id];
    delete state.villagers[unit.id];
  }
  for (const building of Object.values(state.buildings).filter((entity) => entity.hitPoints <= 0)) {
    const player = state.players[building.ownerId];
    if (player !== undefined && building.status === 'complete') {
      player.populationCap = Math.max(0, player.populationCap - BUILDINGS[building.type].populationCap);
    }
    delete state.buildings[building.id];
  }
}

function enemyWorkers(state: GameState): string[] {
  return Object.values(state.villagers).filter((worker) => worker.ownerId === 'enemy_kingdom').sort((a, b) => a.id.localeCompare(b.id)).map((worker) => worker.id);
}

export function enemyAiCommands(state: GameState): GameCommandPayload[] {
  const result: GameCommandPayload[] = [];
  const playerId = 'enemy_kingdom';
  if (state.currentTick === 1) {
    result.push({ type: 'assign_workers', playerId, assignments: { food: 2, wood: 2, stone: 0, iron: 1 } });
  }
  const workers = enemyWorkers(state);
  if (state.currentTick % 100 === 50) {
    const idleWorkers = Object.values(state.villagers)
      .filter((worker) => worker.ownerId === playerId && worker.job === 'idle')
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((worker) => worker.id);
    if (idleWorkers.length > 0) {
      result.push({
        type: 'gather_resource', playerId, villagerIds: idleWorkers,
        resourceNodeId: 'resource_enemy_food',
      });
    }
  }
  const ownedBuildings = Object.values(state.buildings).filter((building) => building.ownerId === playerId);
  const hasType = (type: BuildingState['type']) => ownedBuildings.some((building) => building.type === type);
  if (state.currentTick === 100 && !hasType('house')) result.push({ type: 'place_building', playerId, workerIds: workers.slice(0, 2), buildingType: 'house', position: { x: 1180, y: 390 } });
  if (state.currentTick === 420 && !hasType('barracks')) result.push({ type: 'place_building', playerId, workerIds: workers.slice(0, 2), buildingType: 'barracks', position: { x: 1280, y: 520 } });
  if (state.currentTick === 800 && !hasType('watch_tower')) result.push({ type: 'place_building', playerId, workerIds: workers.slice(0, 2), buildingType: 'watch_tower', position: { x: 1030, y: 280 } });
  if (state.currentTick % 260 === 0) {
    const hall = ownedBuildings.find((building) => building.type === 'town_hall' && building.status === 'complete');
    if (hall !== undefined && workers.length < 9) result.push({ type: 'train_unit', playerId, buildingId: hall.id, unitType: 'villager' });
  }
  if (state.currentTick % 300 === 0) {
    const barracks = ownedBuildings.find((building) => building.type === 'barracks' && building.status === 'complete');
    if (barracks !== undefined) result.push({ type: 'train_unit', playerId, buildingId: barracks.id, unitType: state.currentTick % 600 === 0 ? 'swordsman' : 'spearman' });
  }
  if (state.currentTick > 1700 && state.currentTick % 500 === 0) {
    const army = Object.values(state.units).filter((unit) => unit.ownerId === playerId && unit.type !== 'villager').map((unit) => unit.id).sort();
    const target = state.buildings.building_player_town_hall;
    if (army.length > 0 && target !== undefined) result.push({ type: 'attack_target', playerId, unitIds: army, targetId: target.id });
  }
  return result;
}
