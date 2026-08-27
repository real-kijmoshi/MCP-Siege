import { BUILDINGS, PRODUCTION, UNITS, UPGRADES, hasResources } from '../game/config/gameplay';
import type { GameQueries } from '../game/queries/GameQueries';
import type { SimulationEngine } from '../game/simulation/Engine';
import {
  BUILDING_TYPES, RESOURCE_TYPES, UPGRADE_TYPES,
  type BuildingType, type ResourceType, type UnitType, type UpgradeType,
} from '../game/types/domain';
import { WORLD_HEIGHT, WORLD_WIDTH, type BattlefieldSelection, type GameScene } from '../rendering/phaser/GameScene';
import type { ActivityEntry, MarshalActivityStore } from './MarshalActivity';

const BUILDABLE = BUILDING_TYPES.filter((type) => type !== 'town_hall');
const BUILD_HOTKEYS = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'] as const;

function costText(cost: Record<string, number | undefined>): string {
  return Object.entries(cost).filter(([, amount]) => (amount ?? 0) > 0)
    .map(([resource, amount]) => `${amount} ${resource[0]?.toUpperCase()}`).join(' · ');
}

export class HUD {
  private lastTick = -1;
  private selection: BattlefieldSelection = { kind: 'none' };
  private toastTimer?: number;

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
    this.required('minimap').addEventListener('click', (event) => {
      const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
      this.battlefield.panCameraTo(((event as MouseEvent).clientX - bounds.left) / bounds.width * WORLD_WIDTH, ((event as MouseEvent).clientY - bounds.top) / bounds.height * WORLD_HEIGHT);
    });
    const marshal = this.required<HTMLButtonElement>('marshal-toggle');
    marshal.addEventListener('click', () => this.setMarshalOpen(marshal.getAttribute('aria-expanded') !== 'true'));
    this.required('close-marshal').addEventListener('click', () => this.setMarshalOpen(false));
    this.required('debug-toggle').addEventListener('click', () => this.toggleDebug());
    document.addEventListener('keydown', (event) => this.handleHotkey(event));
    this.battlefield.subscribeSelection((selection) => { this.selection = selection; this.renderSelection(); });
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
    const portrait = this.required('selection-portrait');
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
    actions.innerHTML = '';
    healthFill.style.width = '0%';

    if (this.selection.kind === 'building') {
      const building = snapshot.buildings[this.selection.id];
      if (building === undefined) { this.selection = { kind: 'none' }; return this.renderSelection(); }
      const definition = BUILDINGS[building.type];
      const friendly = building.ownerId === 'player_kingdom';
      const progress = Math.min(1, building.constructionProgress / building.constructionRequired);
      portrait.innerHTML = '<span class="portrait-building"><i></i><b></b></span>';
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
      portrait.innerHTML = `<span class="portrait-unit"><i></i><b>${units.length}</b></span>`;
      kicker.textContent = units.length === 1 ? first.type.toUpperCase() : 'UNIT GROUP';
      name.textContent = units.length === 1 ? UNITS[first.type].label : `${units.length} Selected Units`;
      detail.textContent = workers.length === units.length ? 'GATHER · BUILD · REPAIR' : 'MOVE · ATTACK';
      stateLabel.textContent = workers.length === 1 ? (snapshot.villagers[workers[0]?.id ?? '']?.job.toUpperCase() ?? 'IDLE') : 'READY';
      queue.textContent = workers.length === units.length ? `${workers.length} BUILDERS` : `${units.length} TROOPS`;
      health.textContent = units.length === 1 ? `${Math.ceil(first.hitPoints)} / ${first.maxHitPoints}` : `${units.length} units selected`;
      healthFill.style.width = `${units.reduce((sum, unit) => sum + unit.hitPoints / unit.maxHitPoints, 0) / units.length * 100}%`;
      context.textContent = workers.length === units.length ? 'VILLAGER BUILD MENU' : 'UNIT COMMANDS';
      help.textContent = 'RIGHT-CLICK WORLD TARGETS';
      actions.innerHTML = this.actionButton('move', 'Move', 'M', 'Choose a destination');
      if (workers.length === units.length) {
        actions.innerHTML += BUILDABLE.map((type, index) => this.buildButton(type, BUILD_HOTKEYS[index] ?? '')).join('');
      }
      return;
    }

    if (this.selection.kind === 'resource') {
      const node = snapshot.resourceNodes[this.selection.id];
      if (node === undefined) { this.selection = { kind: 'none' }; return this.renderSelection(); }
      portrait.innerHTML = `<span class="portrait-node portrait-node-${node.type}"><i></i></span>`;
      kicker.textContent = 'WORLD RESOURCE'; name.textContent = node.type === 'iron' ? 'Iron Deposit' : node.type === 'wood' ? 'Forest' : node.type === 'food' ? 'Food Source' : 'Stone Deposit';
      detail.textContent = 'SELECT VILLAGERS, THEN RIGHT-CLICK';
      stateLabel.textContent = `${Math.ceil(node.remaining)} REMAINING`; queue.textContent = 'RAW DEPOSIT';
      health.textContent = 'Gatherable'; healthFill.style.width = `${node.remaining / node.capacity * 100}%`;
      context.textContent = 'RESOURCE SITE'; help.textContent = 'DIRECT WORLD INTERACTION';
      return;
    }

    portrait.innerHTML = '<span class="portrait-none-mark">+</span>';
    kicker.textContent = 'NO SELECTION'; name.textContent = 'Undeveloped Crownlands';
    detail.textContent = 'SELECT VILLAGERS TO BEGIN'; stateLabel.textContent = 'EXPANDABLE'; queue.textContent = '—';
    health.textContent = '—'; context.textContent = 'COMMANDS'; help.textContent = 'BUILD YOUR KINGDOM';
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
      actions.insertAdjacentHTML('beforeend', this.actionButton('train', definition.label, '', costText(definition.cost), { buildingId, unitType }, blocked));
    }
    if (buildingType === 'armoury') {
      for (const upgradeType of UPGRADE_TYPES) {
        const upgrade = UPGRADES[upgradeType];
        const blocked = player.completedUpgrades.includes(upgradeType) || !hasResources(player.resources, upgrade.cost);
        actions.insertAdjacentHTML('beforeend', this.actionButton('upgrade', upgrade.label, '', player.completedUpgrades.includes(upgradeType) ? 'Researched' : costText(upgrade.cost), { buildingId, upgradeType }, blocked));
      }
    }
    const building = snapshot.buildings[buildingId];
    const current = building?.productionQueue[0];
    if (current !== undefined) {
      const progress = Math.floor((1 - current.remainingTicks / current.totalTicks) * 100);
      actions.insertAdjacentHTML('beforeend', `<div class="queue-card"><strong>${UNITS[current.unitType].label} ${progress}%</strong><span>${building?.productionQueue.length ?? 0} in queue</span></div>`);
    }
  }

  private buildButton(type: BuildingType, hotkey: string): string {
    const player = this.engine.getSnapshot().players.player_kingdom;
    const definition = BUILDINGS[type];
    return this.actionButton('build', definition.label, hotkey, `${definition.purpose} — ${costText(definition.cost)}`, { buildingType: type }, player === undefined || !hasResources(player.resources, definition.cost));
  }

  private actionButton(
    action: string, label: string, hotkey: string, title: string,
    data: { buildingId?: string; unitType?: UnitType; upgradeType?: UpgradeType; buildingType?: BuildingType } = {},
    disabled = false,
  ): string {
    const attributes = Object.entries(data).map(([key, value]) => `data-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}="${value}"`).join(' ');
    return `<button class="rts-command${disabled ? ' is-disabled' : ''}" data-action="${action}" ${attributes} ${disabled ? 'disabled' : ''} title="${title}">
      <span class="command-glyph">${action === 'build' ? '⚒' : action === 'train' ? '♟' : action === 'upgrade' ? '⬆' : '✥'}</span><span>${label}</span><kbd>${hotkey}</kbd>
    </button>`;
  }

  private handleAction(event: Event): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
    if (button === null) return;
    const action = button.dataset.action;
    if (action === 'move') {
      this.battlefield.armMoveOrder(); this.showToast('Move order armed — choose a destination.', 'command'); return;
    }
    if (action === 'build' && button.dataset.buildingType !== undefined) {
      this.battlefield.armBuildingPlacement(button.dataset.buildingType as BuildingType);
      this.showToast(`Place ${BUILDINGS[button.dataset.buildingType as BuildingType].label} blueprint on open land.`, 'command'); return;
    }
    if (action === 'train' && button.dataset.buildingId !== undefined && button.dataset.unitType !== undefined) {
      this.engine.dispatch('human', { type: 'train_unit', playerId: 'player_kingdom', buildingId: button.dataset.buildingId, unitType: button.dataset.unitType as UnitType }); return;
    }
    if (action === 'upgrade' && button.dataset.buildingId !== undefined && button.dataset.upgradeType !== undefined) {
      this.engine.dispatch('human', { type: 'research_upgrade', playerId: 'player_kingdom', buildingId: button.dataset.buildingId, upgradeType: button.dataset.upgradeType as UpgradeType });
    }
  }

  private renderMinimap(): void {
    const snapshot = this.engine.getSnapshot();
    const selected = this.selection.kind === 'units' ? new Set(this.selection.ids) : new Set<string>();
    this.required('minimap-entities').innerHTML = [
      ...Object.values(snapshot.buildings).map((building) => `<i class="mini-entity mini-building ${building.ownerId === 'player_kingdom' ? 'friendly' : 'enemy'}" style="left:${building.position.x / WORLD_WIDTH * 100}%;top:${building.position.y / WORLD_HEIGHT * 100}%"></i>`),
      ...Object.values(snapshot.units).map((unit) => `<i class="mini-entity mini-unit ${unit.ownerId === 'player_kingdom' ? 'friendly' : 'enemy'}${selected.has(unit.id) ? ' selected' : ''}" style="left:${unit.position.x / WORLD_WIDTH * 100}%;top:${unit.position.y / WORLD_HEIGHT * 100}%"></i>`),
    ].join('');
    const view = this.battlefield.getCameraViewportNormalized(); const frame = this.required('minimap-viewport');
    frame.style.left = `${view.left * 100}%`; frame.style.top = `${view.top * 100}%`;
    frame.style.width = `${view.width * 100}%`; frame.style.height = `${view.height * 100}%`;
  }

  private handleHotkey(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.ctrlKey || event.altKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === 'escape') { this.battlefield.cancelArmedOrder(); this.setMarshalOpen(false); }
    if (key === 'h') this.battlefield.selectTownHall();
    if (key === 'f') this.battlefield.centerOnSelection();
    if (key === 'a') this.battlefield.selectAllVillagers();
    if (key === 'm' && this.selection.kind === 'units') this.battlefield.armMoveOrder();
    if (this.selection.kind === 'units') {
      const index = BUILD_HOTKEYS.findIndex((candidate) => candidate.toLowerCase() === key);
      const type = BUILDABLE[index];
      if (type !== undefined) this.battlefield.armBuildingPlacement(type);
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
