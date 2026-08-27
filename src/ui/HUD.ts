import { BUILDINGS, PRODUCTION, UNITS, UPGRADES, hasResources } from '../game/config/gameplay';
import type { GameQueries } from '../game/queries/GameQueries';
import type { SimulationEngine } from '../game/simulation/Engine';
import {
  COMBAT_STANCES, FORMATION_TYPES, RESOURCE_TYPES, UPGRADE_TYPES,
  type BuildingType, type CombatStance, type FormationType, type ResourceType, type UnitType, type UpgradeType,
} from '../game/types/domain';
import { WORLD_HEIGHT, WORLD_WIDTH, type BattlefieldSelection, type GameScene } from '../rendering/phaser/GameScene';
import type { ActivityEntry, MarshalActivityStore } from './MarshalActivity';

const BUILD_HOTKEYS = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'] as const;
const BUILD_CATEGORIES = {
  economy: ['house', 'storehouse'],
  military: ['barracks', 'archery_range', 'stable', 'armoury', 'siege_workshop'],
  defense: ['watch_tower', 'wall', 'gate'],
} as const satisfies Record<string, readonly BuildingType[]>;
type BuildCategory = 'root' | keyof typeof BUILD_CATEGORIES;

function costText(cost: Record<string, number | undefined>): string {
  return Object.entries(cost).filter(([, amount]) => (amount ?? 0) > 0)
    .map(([resource, amount]) => `${amount} ${resource[0]?.toUpperCase()}`).join(' · ');
}

export class HUD {
  private lastTick = -1;
  private selection: BattlefieldSelection = { kind: 'none' };
  private toastTimer?: number;
  private lastGroupRecall?: { group: number; at: number };
  private selectionRenderSignature = '';
  private buildCategory: BuildCategory = 'root';

  public constructor(
    private readonly engine: SimulationEngine,
    private readonly queries: GameQueries,
    private readonly activity: MarshalActivityStore,
    private readonly battlefield: GameScene,
  ) {
    for (const element of document.querySelectorAll<HTMLElement>('.bottom-hud, .marshal-drawer, .resource-strip, .realm-button, .marshal-toggle')) {
      element.addEventListener('pointerdown', (event) => event.stopPropagation());
      element.addEventListener('pointerup', (event) => event.stopPropagation());
    }
    this.required('focus-town-hall').addEventListener('click', () => this.battlefield.selectTownHall());
    this.required('focus-selection').addEventListener('click', () => this.battlefield.centerOnSelection());
    this.required('context-actions').addEventListener('click', (event) => this.handleAction(event));
    this.required('selection-composition').addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-filter-unit]');
      if (button?.dataset.filterUnit !== undefined) this.battlefield.filterSelection(button.dataset.filterUnit as UnitType);
    });
    const minimap = this.required('minimap');
    const panFromMinimap = (event: PointerEvent): void => {
      const bounds = minimap.getBoundingClientRect();
      this.battlefield.panCameraTo((event.clientX - bounds.left) / bounds.width * WORLD_WIDTH, (event.clientY - bounds.top) / bounds.height * WORLD_HEIGHT);
    };
    minimap.addEventListener('pointerdown', (event) => { minimap.setPointerCapture(event.pointerId); panFromMinimap(event); });
    minimap.addEventListener('pointermove', (event) => { if (minimap.hasPointerCapture(event.pointerId)) panFromMinimap(event); });
    minimap.addEventListener('pointerup', (event) => minimap.releasePointerCapture(event.pointerId));
    const marshal = this.required<HTMLButtonElement>('marshal-toggle');
    marshal.addEventListener('click', () => this.setMarshalOpen(marshal.getAttribute('aria-expanded') !== 'true'));
    this.required('close-marshal').addEventListener('click', () => this.setMarshalOpen(false));
    this.required('debug-toggle').addEventListener('click', () => this.toggleDebug());
    document.addEventListener('keydown', (event) => this.handleHotkey(event));
    this.battlefield.subscribeSelection((selection) => {
      if (selection.kind !== this.selection.kind || JSON.stringify(selection) !== JSON.stringify(this.selection)) this.buildCategory = 'root';
      this.selection = selection; this.renderSelection();
    });
    this.activity.subscribe((entries) => this.renderActivity(entries));
    this.engine.onCommandResult((command, result) => {
      if (command.source !== 'human') return;
      if (!result.ok) {
        this.activity.record('ERROR', result.message);
        this.showToast(result.message, 'error');
      } else {
        this.activity.record(result.data.warnings.length > 0 ? 'WARNING' : 'SUCCESS', result.summary);
        this.showToast(result.summary, result.data.warnings.length > 0 ? 'warning' : 'success');
      }
    });
    this.render();
  }

  public render(): void {
    const economy = this.queries.getEconomy('player_kingdom');
    if (economy.tick === this.lastTick) return;
    this.lastTick = economy.tick;
    for (const resource of RESOURCE_TYPES) {
      this.required(`[data-resource-value="${resource}"]`).textContent = Math.floor(economy.resources[resource]).toLocaleString();
      this.required(`[data-resource-rate="${resource}"]`).textContent = `+${economy.gatheringRatesPerSecond[resource].toFixed(1)}/s`;
    }
    const capped = economy.population >= economy.populationCap;
    this.required('population-value').textContent = `${economy.population} / ${economy.populationCap}`;
    this.required('population-status').textContent = capped ? 'CAP REACHED — BUILD HOUSE' : 'POPULATION';
    this.required('population-item').classList.toggle('population-capped', capped);
    this.required('game-tick').textContent = String(economy.tick);
    this.required('debug-webmcp').textContent = this.webMcpStatus();
    this.renderMinimap();
    this.renderSelection();
  }

  private renderSelection(): void {
    const snapshot = this.engine.getSnapshot();
    const player = snapshot.players.player_kingdom;
    let actionState: unknown = 'none';
    if (this.selection.kind === 'building') {
      const building = snapshot.buildings[this.selection.id];
      actionState = building === undefined ? this.selection.id : {
        id: building.id, status: building.status, queue: building.productionQueue.map((order) => [order.id, order.unitType]),
      };
    } else if (this.selection.kind === 'units') {
      actionState = this.selection.ids.map((id) => {
        const unit = snapshot.units[id]; return unit === undefined ? id : [id, unit.type, unit.formation, unit.stance];
      });
    } else if (this.selection.kind === 'resource') actionState = snapshot.resourceNodes[this.selection.id]?.id;
    else if (this.selection.kind === 'strategic') actionState = snapshot.strategicSites[this.selection.id]?.id;
    const signature = JSON.stringify([this.selection.kind, this.buildCategory, actionState, player === undefined ? [] : [
      Math.floor(player.resources.food), Math.floor(player.resources.wood), Math.floor(player.resources.stone), Math.floor(player.resources.iron),
      player.population, player.populationCap, player.completedUpgrades,
    ]]);
    if (signature === this.selectionRenderSignature) { this.updateSelectionDynamics(snapshot); return; }
    this.selectionRenderSignature = signature;
    const portrait = this.required('selection-portrait');
    const selectionPanel = this.required('selection-panel');
    selectionPanel.classList.toggle('is-multi', this.selection.kind === 'units' && this.selection.ids.length > 1);
    selectionPanel.classList.toggle('is-single', this.selection.kind === 'units' && this.selection.ids.length === 1);
    const kicker = this.required('selection-kicker');
    const name = this.required('selection-name');
    const detail = this.required('selection-detail');
    const stateLabel = this.required('selection-state');
    const queue = this.required('selection-queue');
    const health = this.required('selection-health');
    const healthFill = this.required('selection-health-fill');
    const context = this.required('command-context-label');
    const help = this.required('command-help');
    const actions = this.required('context-actions');
    const composition = this.required('selection-composition');
    actions.innerHTML = '';
    composition.innerHTML = '';
    healthFill.style.width = '0%';

    if (this.selection.kind === 'building') {
      const building = snapshot.buildings[this.selection.id];
      if (building === undefined) { this.selection = { kind: 'none' }; return this.renderSelection(); }
      const definition = BUILDINGS[building.type];
      const friendly = building.ownerId === 'player_kingdom';
      const progress = Math.min(1, building.constructionProgress / building.constructionRequired);
      portrait.innerHTML = `<span class="portrait-art portrait-building-${building.type}"></span>`;
      kicker.textContent = friendly ? 'FRIENDLY STRUCTURE' : 'ENEMY STRUCTURE';
      name.textContent = `${friendly ? '' : 'Enemy '}${definition.label}`;
      detail.textContent = definition.purpose.toUpperCase();
      stateLabel.textContent = building.status === 'complete' ? 'READY' : `BUILDING ${Math.floor(progress * 100)}%`;
      queue.textContent = building.productionQueue.length === 0 ? 'EMPTY' : `${building.productionQueue.length} QUEUED`;
      health.textContent = `${Math.max(0, Math.ceil(building.hitPoints))} / ${building.maxHitPoints}`;
      healthFill.style.width = `${Math.max(0, building.hitPoints / building.maxHitPoints * 100)}%`;
      context.textContent = `${definition.label.toUpperCase()} COMMANDS`;
      help.textContent = building.status === 'blueprint' ? 'VILLAGERS ARE CONSTRUCTING' : definition.purpose.toUpperCase();
      if (friendly && building.status === 'complete') this.renderBuildingActions(building.id, building.type);
      return;
    }

    if (this.selection.kind === 'units') {
      const units = this.selection.ids.map((id) => snapshot.units[id]).filter((unit) => unit !== undefined);
      const workers = units.filter((unit) => unit.type === 'villager');
      const first = units[0];
      if (first === undefined) { this.selection = { kind: 'none' }; return this.renderSelection(); }
      const counts = new Map<UnitType, number>();
      for (const unit of units) counts.set(unit.type, (counts.get(unit.type) ?? 0) + 1);
      if (units.length === 1) portrait.innerHTML = `<span class="portrait-art portrait-unit-${first.type}"></span>`;
      else {
        const portraitTypes = counts.size === 1
          ? Array.from({ length: Math.min(5, units.length) }, () => first.type)
          : [...counts.keys()].slice(0, 5);
        portrait.innerHTML = `<span class="portrait-squad">${portraitTypes.map((type) => `<i class="portrait-mini portrait-unit-${type}"></i>`).join('')}<b>${units.length}</b></span>`;
      }
      kicker.textContent = units.length === 1 ? first.type.toUpperCase() : 'MULTI-SELECTION';
      name.textContent = units.length === 1 ? UNITS[first.type].label
        : counts.size === 1 ? `${units.length} ${UNITS[first.type].label}${units.length === 1 ? '' : 's'}` : `${units.length} selected`;
      detail.textContent = workers.length === units.length ? 'GATHER · BUILD · REPAIR' : 'MOVE · ATTACK';
      stateLabel.textContent = workers.length === 1 ? (snapshot.villagers[workers[0]?.id ?? '']?.job.toUpperCase() ?? 'IDLE') : 'READY';
      queue.textContent = workers.length === units.length ? `${workers.length} BUILDERS` : `${units.length} TROOPS`;
      health.textContent = units.length === 1 ? `${Math.ceil(first.hitPoints)} / ${first.maxHitPoints}` : `${units.length} units selected`;
      healthFill.style.width = `${units.reduce((sum, unit) => sum + unit.hitPoints / unit.maxHitPoints, 0) / units.length * 100}%`;
      context.textContent = workers.length === units.length
        ? this.buildCategory === 'root' ? 'VILLAGER COMMANDS' : `${this.buildCategory.toUpperCase()} BUILDINGS`
        : 'UNIT COMMANDS';
      help.textContent = 'RIGHT-CLICK WORLD TARGETS';
      if (units.length > 1) composition.innerHTML = [...counts.entries()]
        .map(([type, count]) => `<button data-filter-unit="${type}" title="Select only ${UNITS[type].label}"><i class="portrait-mini portrait-unit-${type}"></i><span>${UNITS[type].label}</span><b>×${count}</b></button>`).join('');
      if (workers.length === units.length) {
        if (this.buildCategory === 'root') {
          actions.innerHTML = [
            this.actionButton('move', 'Move', 'M', 'Choose a destination'),
            this.actionButton('context-help', 'Gather', 'G', 'Right-click a visible resource to gather', { hint: 'gather' }),
            this.actionButton('context-help', 'Repair', 'R', 'Right-click a damaged friendly building to repair', { hint: 'repair' }),
            this.actionButton('build-category', 'Economy', 'B', 'Houses and resource drop-off buildings', { category: 'economy' }),
            this.actionButton('build-category', 'Military', 'V', 'Production and upgrade buildings', { category: 'military' }),
            this.actionButton('build-category', 'Defense', 'C', 'Towers, walls, and gates', { category: 'defense' }),
          ].join('');
        } else {
          const types = BUILD_CATEGORIES[this.buildCategory];
          actions.innerHTML = this.actionButton('build-category', 'Back', 'Esc', 'Return to villager commands', { category: 'root' }) +
            types.map((type, index) => this.buildButton(type, BUILD_HOTKEYS[index] ?? '')).join('');
        }
      } else {
        actions.innerHTML = this.actionButton('move', 'Move', 'M', 'Choose a destination');
        actions.innerHTML += [
          this.actionButton('unit-order', 'Attack Move', 'G', 'Engage enemies while advancing', { order: 'attack_move' }),
          this.actionButton('unit-order', 'Stop', 'S', 'Cancel current orders', { order: 'stop' }),
          this.actionButton('unit-order', 'Hold', 'X', 'Hold position and do not pursue', { order: 'hold_position' }),
          this.actionButton('unit-order', 'Defend', '', 'Move to and defend an area', { order: 'defend_area' }),
          this.actionButton('unit-order', 'Retreat', 'R', 'Withdraw without auto-engaging', { order: 'retreat' }),
          ...FORMATION_TYPES.map((formation) => this.actionButton('formation', formation, '', `${formation} formation`, { formation }, false, units.every((unit) => unit.formation === formation))),
          ...COMBAT_STANCES.map((stance) => this.actionButton('stance', stance.replace('_', ' '), '', `${stance.replace('_', ' ')} stance`, { stance }, false, units.every((unit) => unit.stance === stance))),
        ].join('');
      }
      return;
    }

    if (this.selection.kind === 'resource') {
      const node = snapshot.resourceNodes[this.selection.id];
      if (node === undefined) { this.selection = { kind: 'none' }; return this.renderSelection(); }
      portrait.innerHTML = `<span class="portrait-art portrait-resource-${node.type}"></span>`;
      kicker.textContent = 'WORLD RESOURCE'; name.textContent = node.type === 'iron' ? 'Iron Deposit' : node.type === 'wood' ? 'Forest' : node.type === 'food' ? 'Food Source' : 'Stone Deposit';
      detail.textContent = 'SELECT VILLAGERS, THEN RIGHT-CLICK';
      stateLabel.textContent = `${Math.ceil(node.remaining)} REMAINING`; queue.textContent = 'RAW DEPOSIT';
      health.textContent = 'Gatherable'; healthFill.style.width = `${node.remaining / node.capacity * 100}%`;
      context.textContent = 'RESOURCE SITE'; help.textContent = 'DIRECT WORLD INTERACTION';
      return;
    }

    if (this.selection.kind === 'strategic') {
      const site = snapshot.strategicSites[this.selection.id];
      if (site === undefined) { this.selection = { kind: 'none' }; return this.renderSelection(); }
      portrait.innerHTML = `<span class="portrait-art ${site.type === 'abandoned_watch_tower' ? 'portrait-building-watch_tower' : 'portrait-building-wall'}"></span>`;
      kicker.textContent = 'STRATEGIC LANDMARK'; name.textContent = site.label;
      detail.textContent = site.purpose.toUpperCase();
      stateLabel.textContent = site.controllingPlayerId === undefined ? 'NEUTRAL' : site.controllingPlayerId === 'player_kingdom' ? 'CONTROLLED' : 'ENEMY CONTROL';
      queue.textContent = `${Math.floor(site.captureProgress / site.captureRequired * 100)}% CAPTURE`;
      health.textContent = 'Occupy with military units'; healthFill.style.width = `${site.captureProgress / site.captureRequired * 100}%`;
      context.textContent = 'LANDMARK'; help.textContent = 'CONTROL CREATES A REAL SIMULATION BONUS';
      return;
    }

    portrait.innerHTML = '<span class="portrait-none-mark">+</span>';
    kicker.textContent = 'NO SELECTION'; name.textContent = 'Undeveloped Crownlands';
    detail.textContent = 'SELECT VILLAGERS TO BEGIN'; stateLabel.textContent = 'EXPANDABLE'; queue.textContent = '—';
    health.textContent = '—'; context.textContent = 'COMMANDS'; help.textContent = 'BUILD YOUR KINGDOM';
  }

  private updateSelectionDynamics(snapshot: ReturnType<SimulationEngine['getSnapshot']>): void {
    const health = this.required('selection-health');
    const healthFill = this.required('selection-health-fill');
    if (this.selection.kind === 'building') {
      const building = snapshot.buildings[this.selection.id]; if (building === undefined) return;
      const progress = Math.min(1, building.constructionProgress / building.constructionRequired);
      this.required('selection-state').textContent = building.status === 'complete' ? 'READY' : `BUILDING ${Math.floor(progress * 100)}%`;
      this.required('selection-queue').textContent = building.productionQueue.length === 0 ? 'EMPTY' : `${building.productionQueue.length} QUEUED`;
      health.textContent = `${Math.max(0, Math.ceil(building.hitPoints))} / ${building.maxHitPoints}`;
      healthFill.style.width = `${Math.max(0, building.hitPoints / building.maxHitPoints * 100)}%`;
      building.productionQueue.forEach((order, index) => {
        const item = document.querySelector<HTMLElement>(`[data-order-id="${order.id}"]`); if (item === null) return;
        const percent = index === 0 ? Math.floor((1 - order.remainingTicks / order.totalTicks) * 100) : 0;
        const status = item.querySelector('span'); if (status !== null) status.textContent = `${index === 0 ? `${percent}%` : 'WAITING'} · ×`;
        const bar = item.querySelector<HTMLElement>('i'); if (bar !== null) bar.style.width = `${percent}%`;
      });
      return;
    }
    if (this.selection.kind === 'units') {
      const units = this.selection.ids.map((id) => snapshot.units[id]).filter((unit) => unit !== undefined); if (units.length === 0) return;
      health.textContent = units.length === 1 ? `${Math.ceil(units[0]?.hitPoints ?? 0)} / ${units[0]?.maxHitPoints ?? 0}` : `${units.length} units selected`;
      healthFill.style.width = `${units.reduce((sum, unit) => sum + unit.hitPoints / unit.maxHitPoints, 0) / units.length * 100}%`;
      return;
    }
    if (this.selection.kind === 'resource') {
      const node = snapshot.resourceNodes[this.selection.id]; if (node === undefined) return;
      this.required('selection-state').textContent = `${Math.ceil(node.remaining)} REMAINING`; healthFill.style.width = `${node.remaining / node.capacity * 100}%`; return;
    }
    if (this.selection.kind === 'strategic') {
      const site = snapshot.strategicSites[this.selection.id]; if (site === undefined) return;
      this.required('selection-queue').textContent = `${Math.floor(site.captureProgress / site.captureRequired * 100)}% CAPTURE`;
      healthFill.style.width = `${site.captureProgress / site.captureRequired * 100}%`;
    }
  }

  private renderBuildingActions(buildingId: string, buildingType: BuildingType): void {
    const snapshot = this.engine.getSnapshot();
    const actions = this.required('context-actions');
    const player = snapshot.players.player_kingdom;
    if (player === undefined) return;
    for (const unitType of PRODUCTION[buildingType] ?? []) {
      const definition = UNITS[unitType];
      const queuedPop = Object.values(snapshot.buildings).flatMap((building) => building.ownerId === player.id ? building.productionQueue : []).reduce((sum, order) => sum + UNITS[order.unitType].population, 0);
      const blocked = !hasResources(player.resources, definition.cost) || player.population + queuedPop + definition.population > player.populationCap;
      const reason = player.population + queuedPop + definition.population > player.populationCap
        ? `Population capped. Build a House. ${costText(definition.cost)}`
        : `${costText(definition.cost)} · ${Math.ceil(definition.trainTicks / 20)}s · ${definition.population} pop`;
      actions.insertAdjacentHTML('beforeend', this.actionButton('train', definition.label, '', reason, { buildingId, unitType }, blocked));
    }
    if (buildingType === 'armoury') {
      for (const upgradeType of UPGRADE_TYPES) {
        const upgrade = UPGRADES[upgradeType];
        const blocked = player.completedUpgrades.includes(upgradeType) || !hasResources(player.resources, upgrade.cost);
        actions.insertAdjacentHTML('beforeend', this.actionButton('upgrade', upgrade.label, '', player.completedUpgrades.includes(upgradeType) ? 'Researched' : costText(upgrade.cost), { buildingId, upgradeType }, blocked));
      }
    }
    if ((PRODUCTION[buildingType] ?? []).length > 0) {
      actions.insertAdjacentHTML('beforeend', this.actionButton('rally', 'Rally Point', '', 'New units spawn and move to this point', { buildingId }));
    }
    const building = snapshot.buildings[buildingId];
    if (building !== undefined) {
      building.productionQueue.forEach((order, index) => {
        const progress = index === 0 ? Math.floor((1 - order.remainingTicks / order.totalTicks) * 100) : 0;
        actions.insertAdjacentHTML('beforeend', `<button class="queue-item" data-action="cancel-production" data-building-id="${building.id}" data-order-id="${order.id}" title="Cancel ${UNITS[order.unitType].label}; refunds 50%"><strong>${index + 1}. ${UNITS[order.unitType].label}</strong><span>${index === 0 ? `${progress}%` : 'WAITING'} · ×</span><i style="width:${progress}%"></i></button>`);
      });
    }
  }

  private buildButton(type: BuildingType, hotkey: string): string {
    const player = this.engine.getSnapshot().players.player_kingdom;
    const definition = BUILDINGS[type];
    return this.actionButton('build', definition.label, hotkey, `${definition.purpose} · ${costText(definition.cost)} · ${Math.ceil(definition.buildTicks / 20)}s${definition.populationCap > 0 ? ` · +${definition.populationCap} pop` : ''}`, { buildingType: type }, player === undefined || !hasResources(player.resources, definition.cost));
  }

  private actionButton(
    action: string, label: string, hotkey: string, title: string,
    data: { buildingId?: string; unitType?: UnitType; upgradeType?: UpgradeType; buildingType?: BuildingType; order?: string; formation?: FormationType; stance?: CombatStance; category?: BuildCategory; hint?: string } = {},
    disabled = false, selected = false,
  ): string {
    const attributes = Object.entries(data).map(([key, value]) => `data-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}="${value}"`).join(' ');
    let artClass = data.buildingType === undefined ? '' : `portrait-building-${data.buildingType}`;
    if (data.unitType !== undefined) artClass = `portrait-unit-${data.unitType}`;
    if (data.category === 'economy') artClass = 'portrait-building-house';
    if (data.category === 'military') artClass = 'portrait-building-barracks';
    if (data.category === 'defense') artClass = 'portrait-building-watch_tower';
    const symbols: Record<string, string> = {
      move: '↗', 'context-help': data.hint === 'repair' ? '✚' : '⌁', 'build-category': '‹',
      upgrade: '◆', rally: '⌖', formation: '▥', stance: '◉', 'unit-order': '➤',
    };
    const icon = artClass.length > 0
      ? `<span class="command-art ${artClass}"></span>`
      : `<span class="command-symbol">${symbols[action] ?? '·'}</span>`;
    return `<button class="rts-command${disabled ? ' is-disabled' : ''}${selected ? ' is-selected' : ''}" data-action="${action}" ${attributes} aria-disabled="${disabled}" title="${title}">
      ${icon}<span>${label}</span><kbd>${hotkey}</kbd>
    </button>`;
  }

  private handleAction(event: Event): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
    if (button === null) return;
    const action = button.dataset.action;
    if (action === 'move') {
      this.battlefield.armMoveOrder(); this.showToast('Move order armed — choose a destination.', 'command'); return;
    }
    if (action === 'context-help' && button.dataset.hint !== undefined) {
      this.showToast(button.dataset.hint === 'repair' ? 'Right-click a damaged friendly building to repair it.' : 'Right-click a resource with villagers selected to gather it.', 'command');
      return;
    }
    if (action === 'build-category' && button.dataset.category !== undefined) {
      this.buildCategory = button.dataset.category as BuildCategory; this.selectionRenderSignature = ''; this.renderSelection(); return;
    }
    if (action === 'unit-order' && button.dataset.order !== undefined) {
      this.battlefield.armUnitOrder(button.dataset.order as 'attack_move' | 'stop' | 'hold_position' | 'defend_area' | 'retreat');
      if (!['stop', 'hold_position'].includes(button.dataset.order)) this.showToast(`${button.textContent?.trim() ?? 'Order'} armed — choose a destination.`, 'command');
      return;
    }
    if (action === 'formation' && button.dataset.formation !== undefined) { this.battlefield.setFormation(button.dataset.formation as FormationType); return; }
    if (action === 'stance' && button.dataset.stance !== undefined) { this.battlefield.setStance(button.dataset.stance as CombatStance); return; }
    if (action === 'build' && button.dataset.buildingType !== undefined) {
      this.battlefield.armBuildingPlacement(button.dataset.buildingType as BuildingType);
      this.showToast(`Place ${BUILDINGS[button.dataset.buildingType as BuildingType].label} blueprint on open land.`, 'command'); return;
    }
    if (action === 'train' && button.dataset.buildingId !== undefined && button.dataset.unitType !== undefined) {
      const repeats = event instanceof MouseEvent && event.shiftKey ? 5 : 1;
      for (let index = 0; index < repeats; index += 1) {
        this.engine.dispatch('human', { type: 'train_unit', playerId: 'player_kingdom', buildingId: button.dataset.buildingId, unitType: button.dataset.unitType as UnitType });
      }
      return;
    }
    if (action === 'upgrade' && button.dataset.buildingId !== undefined && button.dataset.upgradeType !== undefined) {
      this.engine.dispatch('human', { type: 'research_upgrade', playerId: 'player_kingdom', buildingId: button.dataset.buildingId, upgradeType: button.dataset.upgradeType as UpgradeType });
    }
    if (action === 'rally' && button.dataset.buildingId !== undefined) {
      this.battlefield.armRallyPoint(button.dataset.buildingId); this.showToast('Choose a rally point.', 'command');
    }
    if (action === 'cancel-production' && button.dataset.buildingId !== undefined && button.dataset.orderId !== undefined) {
      this.engine.dispatch('human', { type: 'cancel_production', playerId: 'player_kingdom', buildingId: button.dataset.buildingId, orderId: button.dataset.orderId });
    }
  }

  private renderMinimap(): void {
    const world = this.queries.getWorldView('player_kingdom');
    const selected = this.selection.kind === 'units' ? new Set(this.selection.ids) : new Set<string>();
    this.required('minimap-entities').innerHTML = [
      ...world.buildings.map((building) => `<i class="mini-entity mini-building ${building.ownerId === 'player_kingdom' ? 'friendly' : 'enemy'}" style="left:${building.position.x / WORLD_WIDTH * 100}%;top:${building.position.y / WORLD_HEIGHT * 100}%"></i>`),
      ...world.units.map((unit) => `<i class="mini-entity mini-unit ${unit.ownerId === 'player_kingdom' ? 'friendly' : 'enemy'}${selected.has(unit.id) ? ' selected' : ''}" style="left:${unit.position.x / WORLD_WIDTH * 100}%;top:${unit.position.y / WORLD_HEIGHT * 100}%"></i>`),
      ...world.strategicSites.map((site) => `<i class="mini-entity mini-site ${site.controllingPlayerId === 'player_kingdom' ? 'friendly' : site.controllingPlayerId === 'enemy_kingdom' ? 'enemy' : 'neutral'}" style="left:${site.position.x / WORLD_WIDTH * 100}%;top:${site.position.y / WORLD_HEIGHT * 100}%"></i>`),
    ].join('');
    const canvas = this.required<HTMLCanvasElement>('minimap-fog');
    const fogScale = 2;
    if (canvas.width !== world.fog.columns * fogScale || canvas.height !== world.fog.rows * fogScale) {
      canvas.width = world.fog.columns * fogScale; canvas.height = world.fog.rows * fogScale;
    }
    const context = canvas.getContext('2d');
    context?.clearRect(0, 0, canvas.width, canvas.height);
    for (let row = 0; row < world.fog.rows; row += 1) {
      for (let column = 0; column < world.fog.columns; column += 1) {
        const state = world.fog.cells[row * world.fog.columns + column] ?? 0;
        if (state === 2 || context === null) continue;
        context.fillStyle = state === 0 ? 'rgba(3, 9, 7, .92)' : 'rgba(7, 13, 10, .55)';
        context.fillRect(column * fogScale, row * fogScale, fogScale, fogScale);
      }
    }
    const view = this.battlefield.getCameraViewportNormalized(); const frame = this.required('minimap-viewport');
    frame.style.left = `${view.left * 100}%`; frame.style.top = `${view.top * 100}%`;
    frame.style.width = `${view.width * 100}%`; frame.style.height = `${view.height * 100}%`;
  }

  private handleHotkey(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.altKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    const group = /^[1-9]$/.test(key) ? Number(key) : undefined;
    if (group !== undefined && event.ctrlKey) {
      event.preventDefault();
      if (this.battlefield.assignControlGroup(group)) this.showToast(`Control group ${group} assigned.`, 'success');
      return;
    }
    if (group !== undefined) {
      const now = performance.now();
      const center = this.lastGroupRecall?.group === group && now - this.lastGroupRecall.at < 420;
      if (this.battlefield.recallControlGroup(group, center)) this.lastGroupRecall = { group, at: now };
      return;
    }
    if (event.ctrlKey) return;
    if (key === 'escape') {
      if (this.buildCategory !== 'root') { this.buildCategory = 'root'; this.selectionRenderSignature = ''; this.renderSelection(); }
      else { this.battlefield.cancelArmedOrder(); this.setMarshalOpen(false); }
      return;
    }
    if (key === 'h') this.battlefield.selectTownHall();
    if (key === 'f') this.battlefield.centerOnSelection();
    if (key === 'a') this.battlefield.selectAllVillagers();
    if (key === 'm' && this.selection.kind === 'units') this.battlefield.armMoveOrder();
    if (this.selection.kind === 'units') {
      const snapshot = this.engine.getSnapshot();
      const allVillagers = this.selection.ids.every((id) => snapshot.villagers[id]?.ownerId === 'player_kingdom');
      if (!allVillagers) {
        if (key === 'g') this.battlefield.armUnitOrder('attack_move');
        if (key === 's') this.battlefield.armUnitOrder('stop');
        if (key === 'x') this.battlefield.armUnitOrder('hold_position');
      } else if (this.buildCategory === 'root') {
        const category = key === 'b' ? 'economy' : key === 'v' ? 'military' : key === 'c' ? 'defense' : undefined;
        if (category !== undefined) { this.buildCategory = category; this.selectionRenderSignature = ''; this.renderSelection(); }
      } else {
        const index = BUILD_HOTKEYS.findIndex((candidate) => candidate.toLowerCase() === key);
        const type = BUILD_CATEGORIES[this.buildCategory][index];
        if (type !== undefined) this.battlefield.armBuildingPlacement(type);
      }
    }
  }

  private renderActivity(entries: readonly ActivityEntry[]): void {
    this.required('activity-list').innerHTML = entries.length === 0 ? '<p class="empty-activity">No Marshal activity yet.</p>' : entries.map((entry) => `
      <article class="activity-entry activity-${entry.kind.toLowerCase()}"><span class="activity-kind">${entry.kind}</span><time>${entry.time}</time><p>${this.escape(entry.message)}</p></article>`).join('');
  }
  private setMarshalOpen(open: boolean): void {
    this.required('marshal-toggle').setAttribute('aria-expanded', String(open));
    this.required('marshal-drawer').setAttribute('aria-hidden', String(!open));
    document.querySelector('.game-shell')?.classList.toggle('marshal-open', open);
    this.required('marshal-chevron').textContent = open ? '−' : '+';
  }
  private toggleDebug(): void {
    const details = this.required('debug-details'); details.hidden = !details.hidden;
    this.required('debug-toggle').textContent = details.hidden ? 'Show diagnostics' : 'Hide diagnostics';
  }
  private showToast(message: string, kind: 'command' | 'success' | 'warning' | 'error'): void {
    const toast = this.required('command-toast'); toast.textContent = message; toast.dataset.kind = kind; toast.classList.add('is-visible');
    if (this.toastTimer !== undefined) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2800);
  }
  private webMcpStatus(): string {
    const status = document.documentElement.dataset.webmcpStatus;
    return status === 'connected' ? `${document.documentElement.dataset.webmcpTools ?? '0'} tools` : status === 'failed' ? 'Unavailable' : 'Detecting';
  }
  private escape(value: string): string { const span = document.createElement('span'); span.textContent = value; return span.innerHTML; }
  private required<T extends HTMLElement = HTMLElement>(idOrSelector: string): T {
    const element = idOrSelector.startsWith('[') ? document.querySelector<T>(idOrSelector) : document.getElementById(idOrSelector) as T | null;
    if (element === null) throw new Error(`Missing HUD element: ${idOrSelector}`); return element;
  }
}
