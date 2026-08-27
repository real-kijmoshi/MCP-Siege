import { BUILDINGS, GATHER_PER_TICK, TICKS_PER_SECOND, UNITS } from '../config/gameplay';
import type { GameCommandPayload } from '../commands/types';
import type { BuildingState, UnitState } from '../types/domain';
import type { GameState } from './GameState';
import { checkBuildingPlacement } from './Placement';

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
    if (order.kind === 'repair') {
      const building = order.targetId === undefined ? undefined : state.buildings[order.targetId];
      if (building === undefined || building.status !== 'complete' || building.hitPoints >= building.maxHitPoints) {
        delete unit.order;
        const worker = state.villagers[unit.id]; if (worker !== undefined) worker.job = 'idle';
        continue;
      }
      order.targetPosition = { ...building.position };
      const arrived = moveToward(unit, building.position, BUILDINGS[building.type].footprint + 16);
      const worker = state.villagers[unit.id]; if (worker !== undefined) worker.job = arrived ? 'repairing' : 'moving';
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
      continue;
    }
    if (order.kind === 'attack_move') {
      const target = nearestEnemy(state, unit.ownerId, unit.position, unit.stance === 'aggressive' ? 220 : 150);
      if (target !== undefined) {
        unit.order = { kind: 'attack', targetId: target.id, targetPosition: { ...target.position } };
      } else if (moveToward(unit, order.targetPosition, 2)) delete unit.order;
      continue;
    }
    if (order.kind === 'defend' || order.kind === 'retreat') {
      if (moveToward(unit, order.targetPosition, 2)) {
        if (order.kind === 'defend') unit.order = { kind: 'hold', targetPosition: { ...unit.position } };
        else delete unit.order;
        const worker = state.villagers[unit.id]; if (worker !== undefined) worker.job = 'idle';
      }
      continue;
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
  for (const building of Object.values(state.buildings).sort((a, b) => a.id.localeCompare(b.id))) {
    if (building.status !== 'complete' || building.hitPoints >= building.maxHitPoints) continue;
    const repairers = Object.values(state.villagers).filter((worker) => worker.order?.kind === 'repair' &&
      worker.order.targetId === building.id && worker.job === 'repairing');
    building.hitPoints = Math.min(building.maxHitPoints, building.hitPoints + repairers.length * 0.75);
    if (building.hitPoints < building.maxHitPoints) continue;
    for (const worker of repairers) { worker.job = 'idle'; delete worker.order; }
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
    formation: type === 'scout' ? 'loose' : 'square', stance: type === 'villager' ? 'defensive' : 'aggressive',
  };
  if (building.rallyPoint !== undefined) {
    unit.order = { kind: 'move', targetPosition: { ...building.rallyPoint } };
  }
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
    if (unit.order?.kind === 'retreat') continue;
    let target = unit.order?.kind === 'attack' && unit.order.targetId !== undefined
      ? state.units[unit.order.targetId] ?? state.buildings[unit.order.targetId] : undefined;
    const awareness = unit.stance === 'aggressive' ? 210 : unit.stance === 'defensive' ? 145 : 75;
    target ??= nearestEnemy(state, unit.ownerId, unit.position, awareness);
    if (target !== undefined && unit.order === undefined && unit.stance === 'aggressive') {
      unit.order = { kind: 'attack', targetId: target.id, targetPosition: { ...target.position } };
    }
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
  for (const site of Object.values(state.strategicSites).filter((item) => item.type === 'abandoned_watch_tower' && item.controllingPlayerId !== undefined)) {
    if (state.currentTick % 24 !== 0 || site.controllingPlayerId === undefined) continue;
    const target = nearestEnemy(state, site.controllingPlayerId, site.position, 220);
    if (target !== undefined) target.hitPoints -= 10;
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

export function advanceStrategicSites(state: GameState): void {
  for (const site of Object.values(state.strategicSites).sort((a, b) => a.id.localeCompare(b.id))) {
    const nearby = Object.values(state.units).filter((unit) => unit.type !== 'villager' && distance(unit.position, site.position) <= 82);
    const owners = [...new Set(nearby.map((unit) => unit.ownerId))].sort();
    if (owners.length === 1) {
      const ownerId = owners[0];
      if (ownerId !== undefined && site.controllingPlayerId !== ownerId) {
        if (site.capturePlayerId !== ownerId) { site.capturePlayerId = ownerId; site.captureProgress = 0; }
        site.captureProgress += Math.sqrt(nearby.length);
        if (site.captureProgress >= site.captureRequired) {
          site.controllingPlayerId = ownerId; site.captureProgress = site.captureRequired;
        }
      }
    } else if (owners.length > 1) {
      site.captureProgress = Math.max(0, site.captureProgress - 0.5);
    }
    if (site.controllingPlayerId === undefined || state.currentTick % TICKS_PER_SECOND !== 0) continue;
    const player = state.players[site.controllingPlayerId]; if (player === undefined) continue;
    if (site.type === 'capture_point') { player.resources.food += 0.5; player.resources.wood += 0.5; }
    if (site.type === 'ruined_fort') { player.resources.stone += 0.35; player.resources.iron += 0.25; }
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
      const resourceCycle = ['food', 'wood', 'stone', 'iron'] as const;
      const desiredType = resourceCycle[Math.floor(state.currentTick / 100) % resourceCycle.length] ?? 'food';
      const node = Object.values(state.resourceNodes).filter((candidate) => candidate.remaining > 0 && candidate.type === desiredType)
        .sort((a, b) => distance(a.position, { x: 2660, y: 300 }) - distance(b.position, { x: 2660, y: 300 }) || a.id.localeCompare(b.id))[0];
      if (node !== undefined) result.push({ type: 'gather_resource', playerId, villagerIds: idleWorkers, resourceNodeId: node.id });
    }
  }
  const ownedBuildings = Object.values(state.buildings).filter((building) => building.ownerId === playerId);
  const hasType = (type: BuildingState['type']) => ownedBuildings.some((building) => building.type === type);
  const queueBuilding = (buildingType: BuildingState['type'], workerIds: string[], preferred: { x: number; y: number }): void => {
    for (let radius = 0; radius <= 600; radius += 90) {
      const candidates = radius === 0 ? [preferred] : [
        { x: preferred.x + radius, y: preferred.y }, { x: preferred.x, y: preferred.y + radius },
        { x: preferred.x - radius, y: preferred.y }, { x: preferred.x, y: preferred.y - radius },
        { x: preferred.x + radius, y: preferred.y + radius }, { x: preferred.x - radius, y: preferred.y + radius },
      ];
      const position = candidates.find((candidate) => checkBuildingPlacement(state, buildingType, candidate).valid);
      if (position !== undefined) { result.push({ type: 'place_building', playerId, workerIds, buildingType, position }); return; }
    }
  };
  const enemyPlayer = state.players[playerId];
  const queuedPopulation = ownedBuildings.flatMap((building) => building.productionQueue)
    .reduce((sum, order) => sum + UNITS[order.unitType].population, 0);
  const houseCount = ownedBuildings.filter((building) => building.type === 'house').length;
  const activeBlueprint = ownedBuildings.some((building) => building.status === 'blueprint');
  if (!activeBlueprint && state.currentTick > 900 && state.currentTick % 800 === 50) {
    const total = workers.length;
    const assignments = {
      food: Math.min(3, total), wood: Math.min(2, Math.max(0, total - 3)),
      stone: Math.min(2, Math.max(0, total - 5)), iron: Math.max(0, total - 7),
    };
    result.push({ type: 'assign_workers', playerId, assignments });
  }
  if (enemyPlayer !== undefined && state.currentTick % 100 === 0 && !activeBlueprint) {
    if (!hasType('house')) queueBuilding('house', workers.slice(0, 2), { x: 2510, y: 260 });
    else if (state.currentTick >= 420 && !hasType('barracks')) queueBuilding('barracks', workers.slice(0, 2), { x: 2740, y: 500 });
    else if (enemyPlayer.population + queuedPopulation >= enemyPlayer.populationCap - 2 && houseCount < 4) queueBuilding('house', workers.slice(0, 2), { x: 2470 + houseCount * 70, y: 170 });
    else if (state.currentTick >= 800 && !hasType('watch_tower')) queueBuilding('watch_tower', workers.slice(0, 2), { x: 2410, y: 500 });
    else if (state.currentTick >= 1050 && !hasType('archery_range')) queueBuilding('archery_range', workers.slice(2, 4), { x: 2850, y: 390 });
    else if (state.currentTick >= 1550 && !hasType('stable')) queueBuilding('stable', workers.slice(0, 3), { x: 2570, y: 610 });
    else if (state.currentTick >= 2050 && !hasType('armoury')) queueBuilding('armoury', workers.slice(2, 5), { x: 2940, y: 570 });
    else if (state.currentTick >= 2750 && !hasType('siege_workshop')) queueBuilding('siege_workshop', workers.slice(0, 3), { x: 2690, y: 700 });
  }
  if (state.currentTick % 260 === 0) {
    const hall = ownedBuildings.find((building) => building.type === 'town_hall' && building.status === 'complete');
    if (hall !== undefined && workers.length < 9) result.push({ type: 'train_unit', playerId, buildingId: hall.id, unitType: 'villager' });
  }
  if (state.currentTick % 300 === 0) {
    const barracks = ownedBuildings.find((building) => building.type === 'barracks' && building.status === 'complete');
    if (barracks !== undefined) result.push({ type: 'train_unit', playerId, buildingId: barracks.id, unitType: state.currentTick % 600 === 0 ? 'swordsman' : 'spearman' });
  }
  if (state.currentTick % 340 === 20) {
    const range = ownedBuildings.find((building) => building.type === 'archery_range' && building.status === 'complete');
    if (range !== undefined) result.push({ type: 'train_unit', playerId, buildingId: range.id, unitType: 'archer' });
  }
  if (state.currentTick % 460 === 30) {
    const stable = ownedBuildings.find((building) => building.type === 'stable' && building.status === 'complete');
    if (stable !== undefined) result.push({ type: 'train_unit', playerId, buildingId: stable.id, unitType: Math.floor(state.currentTick / 460) % 2 === 0 ? 'scout' : 'knight' });
  }
  if (state.currentTick % 620 === 40) {
    const workshop = ownedBuildings.find((building) => building.type === 'siege_workshop' && building.status === 'complete');
    if (workshop !== undefined) result.push({ type: 'train_unit', playerId, buildingId: workshop.id, unitType: state.currentTick % 1240 === 40 ? 'catapult' : 'battering_ram' });
  }
  if (state.currentTick > 900 && state.currentTick % 420 === 110) {
    const patrol = Object.values(state.units).filter((unit) => unit.ownerId === playerId && (unit.type === 'scout' || unit.type === 'spearman')).map((unit) => unit.id).sort().slice(0, 6);
    if (patrol.length > 0) result.push({ type: 'issue_unit_order', playerId, unitIds: patrol, order: 'defend_area', destination: { x: 2060, y: 880 }, formation: 'loose', stance: 'defensive' });
  }
  if (state.currentTick > 1900 && state.currentTick % 500 === 0) {
    const army = Object.values(state.units).filter((unit) => unit.ownerId === playerId && unit.type !== 'villager').map((unit) => unit.id).sort();
    const target = state.buildings.building_player_town_hall;
    if (army.length > 0 && target !== undefined) result.push({ type: 'attack_target', playerId, unitIds: army, targetId: target.id });
  }
  return result;
}
