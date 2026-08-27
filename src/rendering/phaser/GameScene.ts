import Phaser from 'phaser';
import { BUILDINGS, FOG_COLUMNS, FOG_ROWS, UNITS, WORLD_HEIGHT, WORLD_WIDTH } from '../../game/config/gameplay';
import type { GameQueries, WorldView } from '../../game/queries/GameQueries';
import type { SimulationEngine } from '../../game/simulation/Engine';
import type {
  BuildingState, BuildingType, CombatStance, FormationType, MilitaryOrderType,
  ResourceNodeState, StrategicSiteState, UnitState, UnitType,
} from '../../game/types/domain';

export { WORLD_HEIGHT, WORLD_WIDTH };

export type BattlefieldSelection =
  | { kind: 'none' }
  | { kind: 'building'; id: string }
  | { kind: 'resource'; id: string }
  | { kind: 'strategic'; id: string }
  | { kind: 'units'; ids: string[] };
type SelectionListener = (selection: BattlefieldSelection) => void;
export interface CameraViewportProjection { left: number; top: number; width: number; height: number }

interface UnitView {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
  ring: Phaser.GameObjects.Ellipse;
  healthBg: Phaser.GameObjects.Rectangle;
  health: Phaser.GameObjects.Rectangle;
}
interface BuildingView {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
  ring: Phaser.GameObjects.Ellipse;
  progressBg: Phaser.GameObjects.Rectangle;
  progress: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}
interface ResourceView {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Shape;
  label: Phaser.GameObjects.Text;
}
interface StrategicView {
  container: Phaser.GameObjects.Container;
  ring: Phaser.GameObjects.Ellipse;
  progress: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

const ATLAS_FRAMES = [
  ['town_hall', 0, 0, 314, 314], ['house', 314, 0, 313, 314], ['barracks', 627, 0, 314, 314], ['storehouse', 941, 0, 313, 314],
  ['archery_range', 0, 314, 314, 313], ['stable', 314, 314, 313, 313], ['armoury', 627, 314, 314, 313], ['siege_workshop', 941, 314, 313, 313],
  ['watch_tower', 0, 627, 314, 314], ['wall', 314, 627, 313, 314], ['gate', 627, 627, 314, 314], ['villager', 941, 627, 313, 314],
  ['wood', 0, 941, 314, 313], ['food', 314, 941, 313, 313], ['stone', 627, 941, 314, 313], ['iron', 941, 941, 313, 313],
] as const;

export class GameScene extends Phaser.Scene {
  private readonly unitViews = new Map<string, UnitView>();
  private readonly buildingViews = new Map<string, BuildingView>();
  private readonly resourceViews = new Map<string, ResourceView>();
  private readonly strategicViews = new Map<string, StrategicView>();
  private readonly controlGroups = new Map<number, string[]>();
  private readonly listeners = new Set<SelectionListener>();
  private selection: BattlefieldSelection = { kind: 'none' };
  private cursorKeys?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private dragStart: Phaser.Math.Vector2 | undefined;
  private selectionBox?: Phaser.GameObjects.Graphics;
  private fog?: Phaser.GameObjects.Image;
  private fogTexture: Phaser.Textures.CanvasTexture | undefined;
  private fogSource: HTMLCanvasElement | undefined;
  private rallyOverlay?: Phaser.GameObjects.Graphics;
  private lastFogTick = -1;
  private armedUnitOrder: MilitaryOrderType | 'move' | undefined;
  private rallyArmed: string | undefined;
  private buildArmed: BuildingType | undefined;
  private placementSprite: Phaser.GameObjects.Image | undefined;
  private placementFootprint: Phaser.GameObjects.Ellipse | undefined;
  private placementLabel: Phaser.GameObjects.Text | undefined;
  private lastUnitClick?: { id: string; at: number };
  private minimumZoom = 0.52;
  private ready = false;

  public constructor(private readonly engine: SimulationEngine, private readonly queries: GameQueries) { super('battlefield'); }

  public preload(): void {
    this.load.image('battlefield-terrain', '/assets/world/battlefield-terrain.png');
    this.load.image('medieval-atlas', '/assets/world/medieval-atlas.png');
  }

  public subscribeSelection(listener: SelectionListener): () => void {
    this.listeners.add(listener); listener(this.getSelection()); return () => this.listeners.delete(listener);
  }
  public getSelection(): BattlefieldSelection {
    return this.selection.kind === 'units' ? { kind: 'units', ids: [...this.selection.ids] } : { ...this.selection };
  }
  public selectTownHall(): void {
    this.setSelection({ kind: 'building', id: 'building_player_town_hall' });
    const hall = this.engine.getSnapshot().buildings.building_player_town_hall;
    if (hall !== undefined) this.cameras.main?.pan(hall.position.x, hall.position.y, 250, 'Sine.easeInOut');
  }
  public selectAllVillagers(): void {
    const ids = Object.values(this.engine.getSnapshot().villagers)
      .filter((worker) => worker.ownerId === 'player_kingdom').map((worker) => worker.id).sort();
    this.setSelection(ids.length === 0 ? { kind: 'none' } : { kind: 'units', ids });
  }
  public armMoveOrder(): void {
    if (this.selection.kind !== 'units') return;
    this.armedUnitOrder = 'move'; this.buildArmed = undefined; this.rallyArmed = undefined;
    this.clearPlacementGhost(); this.game.canvas.classList.add('order-mode');
  }
  public armUnitOrder(order: MilitaryOrderType): void {
    if (this.selection.kind !== 'units') return;
    if (order === 'stop' || order === 'hold_position') {
      this.engine.dispatch('human', { type: 'issue_unit_order', playerId: 'player_kingdom', unitIds: [...this.selection.ids], order });
      return;
    }
    this.armedUnitOrder = order; this.buildArmed = undefined; this.rallyArmed = undefined;
    this.clearPlacementGhost(); this.game.canvas.classList.add('order-mode');
  }
  public setFormation(formation: FormationType): void {
    if (this.selection.kind !== 'units') return;
    this.engine.dispatch('human', { type: 'issue_unit_order', playerId: 'player_kingdom', unitIds: [...this.selection.ids], order: 'set_formation', formation });
  }
  public setStance(stance: CombatStance): void {
    if (this.selection.kind !== 'units') return;
    this.engine.dispatch('human', { type: 'issue_unit_order', playerId: 'player_kingdom', unitIds: [...this.selection.ids], order: 'set_stance', stance });
  }
  public armRallyPoint(buildingId: string): void {
    this.rallyArmed = buildingId; this.armedUnitOrder = undefined; this.buildArmed = undefined;
    this.clearPlacementGhost(); this.game.canvas.classList.add('order-mode');
  }
  public armBuildingPlacement(type: BuildingType): void {
    if (this.selection.kind !== 'units') return;
    const snapshot = this.engine.getSnapshot();
    if (!this.selection.ids.every((id) => snapshot.villagers[id]?.ownerId === 'player_kingdom')) return;
    this.buildArmed = type; this.armedUnitOrder = undefined; this.rallyArmed = undefined;
    this.createPlacementGhost(type); this.game.canvas.classList.add('order-mode');
  }
  public cancelArmedOrder(): void {
    this.armedUnitOrder = undefined; this.rallyArmed = undefined; this.buildArmed = undefined;
    this.clearPlacementGhost(); this.game.canvas.classList.remove('order-mode');
  }
  public assignControlGroup(index: number): boolean {
    if (this.selection.kind !== 'units' || this.selection.ids.length === 0) return false;
    this.controlGroups.set(index, [...this.selection.ids]); return true;
  }
  public recallControlGroup(index: number, center = false): boolean {
    const snapshot = this.engine.getSnapshot();
    const ids = (this.controlGroups.get(index) ?? []).filter((id) => snapshot.units[id]?.ownerId === 'player_kingdom');
    if (ids.length === 0) return false;
    this.controlGroups.set(index, ids); this.setSelection({ kind: 'units', ids });
    if (center) this.centerOnSelection(); return true;
  }
  public filterSelection(type: UnitType): void {
    if (this.selection.kind !== 'units') return;
    const snapshot = this.engine.getSnapshot();
    const ids = this.selection.ids.filter((id) => snapshot.units[id]?.type === type);
    if (ids.length > 0) this.setSelection({ kind: 'units', ids });
  }
  public centerOnSelection(): void {
    const snapshot = this.engine.getSnapshot();
    let positions: Array<{ x: number; y: number }> = [];
    if (this.selection.kind === 'units') positions = this.selection.ids.map((id) => snapshot.units[id]?.position).filter((position) => position !== undefined);
    if (this.selection.kind === 'building') {
      const position = snapshot.buildings[this.selection.id]?.position; if (position !== undefined) positions = [position];
    }
    if (this.selection.kind === 'resource') {
      const position = snapshot.resourceNodes[this.selection.id]?.position; if (position !== undefined) positions = [position];
    }
    if (this.selection.kind === 'strategic') {
      const position = snapshot.strategicSites[this.selection.id]?.position; if (position !== undefined) positions = [position];
    }
    if (positions.length === 0) return;
    this.cameras.main.pan(positions.reduce((sum, position) => sum + position.x, 0) / positions.length, positions.reduce((sum, position) => sum + position.y, 0) / positions.length, 250, 'Sine.easeInOut');
  }
  public panCameraTo(x: number, y: number): void {
    this.cameras.main?.pan(Phaser.Math.Clamp(x, 0, WORLD_WIDTH), Phaser.Math.Clamp(y, 0, WORLD_HEIGHT), 220, 'Sine.easeInOut');
  }
  public getCameraViewportNormalized(): CameraViewportProjection {
    if (!this.ready) return { left: 0, top: 0, width: 1, height: 1 };
    const view = this.cameras.main.worldView;
    return { left: view.x / WORLD_WIDTH, top: view.y / WORLD_HEIGHT, width: view.width / WORLD_WIDTH, height: view.height / WORLD_HEIGHT };
  }

  public create(): void {
    this.ready = true;
    this.registerAtlasFrames();
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT).centerOn(610, 1570).setZoom(0.82);
    this.drawTerrain();
    this.createFogLayer();
    this.rallyOverlay = this.add.graphics().setDepth(8_900);
    this.selectionBox = this.add.graphics().setScrollFactor(0).setDepth(10_000);
    this.fitCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitCamera, this);
    this.game.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    if (this.input.keyboard !== null) {
      this.cursorKeys = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys('W,A,S,D') as Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
    }
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (pointer.button === 0) this.dragStart = new Phaser.Math.Vector2(pointer.x, pointer.y);
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (this.buildArmed !== undefined) {
        const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y); this.updatePlacementGhost(world.x, world.y); return;
      }
      if (this.dragStart === undefined || !pointer.isDown) return;
      this.drawSelectionBox(this.dragStart.x, this.dragStart.y, pointer.x, pointer.y);
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => this.handlePointerUp(pointer));
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      const camera = this.cameras.main;
      const before = camera.getWorldPoint(pointer.x, pointer.y);
      camera.setZoom(Phaser.Math.Clamp(camera.zoom - dy * 0.0008, this.minimumZoom, 1.45));
      const after = camera.getWorldPoint(pointer.x, pointer.y);
      camera.scrollX += before.x - after.x; camera.scrollY += before.y - after.y;
    });
    this.engine.onCommandResult((command, result) => {
      if (command.source === 'human' && command.type === 'place_building' && result.ok && result.data.buildingId !== undefined) {
        this.setSelection({ kind: 'building', id: result.data.buildingId });
      }
    });
    this.selectTownHall();
  }

  public override update(_time: number, delta: number): void {
    this.updateCamera(delta);
    const world = this.queries.getWorldView('player_kingdom');
    if (world.tick !== this.lastFogTick) { this.updateFog(world); this.lastFogTick = world.tick; }
    const selectedUnits = this.selection.kind === 'units' ? new Set(this.selection.ids) : new Set<string>();
    const activeUnits = new Set<string>();
    for (const unit of world.units) {
      activeUnits.add(unit.id);
      const view = this.unitViews.get(unit.id) ?? this.createUnit(unit);
      view.container.x = Phaser.Math.Linear(view.container.x, unit.position.x, 0.18);
      view.container.y = Phaser.Math.Linear(view.container.y, unit.position.y, 0.18);
      view.container.setDepth(Math.round(view.container.y + 40));
      view.ring.setVisible(selectedUnits.has(unit.id));
      const healthRatio = Math.max(0, unit.hitPoints / unit.maxHitPoints);
      view.health.setScale(healthRatio, 1).setFillStyle(healthRatio < 0.35 ? 0xc9554c : healthRatio < 0.7 ? 0xd2a84f : 0x70b765);
      const showHealth = selectedUnits.has(unit.id) || unit.hitPoints < unit.maxHitPoints;
      view.health.setVisible(showHealth); view.healthBg.setVisible(showHealth);
    }
    for (const [id, view] of this.unitViews) if (!activeUnits.has(id)) { view.container.destroy(); this.unitViews.delete(id); }

    const activeBuildings = new Set<string>();
    for (const building of world.buildings) {
      activeBuildings.add(building.id);
      const view = this.buildingViews.get(building.id) ?? this.createBuilding(building);
      const progress = building.constructionProgress / building.constructionRequired;
      view.sprite.setAlpha(building.status === 'complete' ? 1 : 0.34 + progress * 0.55);
      view.ring.setVisible(this.selection.kind === 'building' && this.selection.id === building.id);
      view.progressBg.setVisible(building.status === 'blueprint');
      view.progress.setVisible(building.status === 'blueprint').setScale(Math.max(0.02, progress), 1);
      view.label.setText(building.status === 'blueprint' ? `${BUILDINGS[building.type].label} ${Math.floor(progress * 100)}%` : BUILDINGS[building.type].label);
    }
    for (const [id, view] of this.buildingViews) if (!activeBuildings.has(id)) { view.container.destroy(); this.buildingViews.delete(id); }
    this.rallyOverlay?.clear();
    if (this.selection.kind === 'building') {
      const selectedId = this.selection.id;
      const selectedBuilding = world.buildings.find((building) => building.id === selectedId);
      if (selectedBuilding?.rallyPoint !== undefined) {
        this.rallyOverlay?.lineStyle(2, 0x78bfe2, 0.7).lineBetween(selectedBuilding.position.x, selectedBuilding.position.y, selectedBuilding.rallyPoint.x, selectedBuilding.rallyPoint.y)
          .strokeCircle(selectedBuilding.rallyPoint.x, selectedBuilding.rallyPoint.y, 13);
      }
    }

    const activeResources = new Set<string>();
    for (const node of world.resourceNodes) {
      activeResources.add(node.id);
      const view = this.resourceViews.get(node.id) ?? this.createResource(node);
      view.container.setAlpha(node.remaining <= 0 ? 0.12 : 0.5 + 0.5 * node.remaining / node.capacity);
    }
    for (const [id, view] of this.resourceViews) if (!activeResources.has(id)) { view.container.destroy(); this.resourceViews.delete(id); }

    const activeSites = new Set<string>();
    for (const site of world.strategicSites) {
      activeSites.add(site.id);
      const view = this.strategicViews.get(site.id) ?? this.createStrategicSite(site);
      view.ring.setVisible(this.selection.kind === 'strategic' && this.selection.id === site.id);
      const progress = site.captureProgress / site.captureRequired;
      view.progress.setScale(Math.max(0.02, progress), 1).setFillStyle(
        site.controllingPlayerId === 'player_kingdom' ? 0xe1bd69 : site.controllingPlayerId === 'enemy_kingdom' ? 0xc9554c : 0xa99c7c,
      );
      view.label.setText(`${site.label}${site.controllingPlayerId === undefined ? '' : site.controllingPlayerId === 'player_kingdom' ? ' · Crownlands' : ' · Ashen Host'}`);
    }
    for (const [id, view] of this.strategicViews) if (!activeSites.has(id)) { view.container.destroy(); this.strategicViews.delete(id); }

    if (this.selection.kind === 'building' && !activeBuildings.has(this.selection.id)) this.setSelection({ kind: 'none' });
    if (this.selection.kind === 'units') {
      const ids = this.selection.ids.filter((id) => activeUnits.has(id));
      if (ids.length !== this.selection.ids.length) this.setSelection(ids.length === 0 ? { kind: 'none' } : { kind: 'units', ids });
    }
  }

  private registerAtlasFrames(): void {
    if (!this.textures.exists('medieval-atlas')) return;
    const texture = this.textures.get('medieval-atlas');
    for (const [name, x, y, width, height] of ATLAS_FRAMES) {
      if (!texture.has(name)) texture.add(name, 0, x, y, width, height);
    }
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    if (pointer.button === 2) {
      if (this.buildArmed !== undefined || this.armedUnitOrder !== undefined || this.rallyArmed !== undefined) this.cancelArmedOrder();
      else this.issueContextOrder(world.x, world.y);
      this.dragStart = undefined; this.selectionBox?.clear(); return;
    }
    if (pointer.button !== 0 || this.dragStart === undefined) return;
    if (this.buildArmed !== undefined && this.selection.kind === 'units') {
      const type = this.buildArmed;
      const position = { x: Math.round(world.x), y: Math.round(world.y) };
      const placement = this.queries.checkBuildingPlacement('player_kingdom', type, position);
      if (placement.valid) {
        this.engine.dispatch('human', { type: 'place_building', playerId: 'player_kingdom', workerIds: [...this.selection.ids], buildingType: type, position });
        this.showMarker(world.x, world.y, 0x6fbc70); this.cancelArmedOrder();
      } else this.showMarker(world.x, world.y, 0xc64d48);
    } else if (this.rallyArmed !== undefined) {
      this.engine.dispatch('human', { type: 'set_rally_point', playerId: 'player_kingdom', buildingId: this.rallyArmed, position: { x: Math.round(world.x), y: Math.round(world.y) } });
      this.showMarker(world.x, world.y, 0x75bfe2); this.cancelArmedOrder();
    } else {
      const distance = Phaser.Math.Distance.Between(this.dragStart.x, this.dragStart.y, pointer.x, pointer.y);
      if (distance > 9) this.selectBox(this.dragStart, new Phaser.Math.Vector2(pointer.x, pointer.y), pointer);
      else if (this.armedUnitOrder !== undefined) this.issueArmedUnitOrder(world.x, world.y);
      else this.selectAt(world.x, world.y, pointer);
    }
    this.dragStart = undefined; this.selectionBox?.clear();
  }

  private issueContextOrder(x: number, y: number): void {
    if (this.selection.kind !== 'units') return;
    const snapshot = this.engine.getSnapshot();
    const world = this.queries.getWorldView('player_kingdom');
    const targetNode = this.closestResource(world.resourceNodes, x, y);
    const villagers = this.selection.ids.filter((id) => snapshot.villagers[id]?.ownerId === 'player_kingdom');
    if (targetNode !== undefined && villagers.length === this.selection.ids.length) {
      this.engine.dispatch('human', { type: 'gather_resource', playerId: 'player_kingdom', villagerIds: villagers, resourceNodeId: targetNode.id });
      this.showMarker(targetNode.position.x, targetNode.position.y, 0xe1bd69); return;
    }
    const clickedBuilding = world.buildings
      .map((entity) => ({ entity, distance: Phaser.Math.Distance.Between(x, y, entity.position.x, entity.position.y) }))
      .filter((item) => item.distance <= BUILDINGS[item.entity.type].footprint + 12).sort((a, b) => a.distance - b.distance)[0]?.entity;
    if (clickedBuilding?.ownerId === 'player_kingdom' && villagers.length === this.selection.ids.length) {
      if (clickedBuilding.status === 'blueprint') {
        this.engine.dispatch('human', { type: 'assist_building', playerId: 'player_kingdom', villagerIds: villagers, buildingId: clickedBuilding.id });
        this.showMarker(clickedBuilding.position.x, clickedBuilding.position.y, 0x69b9df); return;
      }
      if (clickedBuilding.hitPoints < clickedBuilding.maxHitPoints) {
        this.engine.dispatch('human', { type: 'repair_building', playerId: 'player_kingdom', villagerIds: villagers, buildingId: clickedBuilding.id });
        this.showMarker(clickedBuilding.position.x, clickedBuilding.position.y, 0x70c66b); return;
      }
    }
    const target = [...world.units, ...world.buildings]
      .filter((entity) => entity.ownerId !== 'player_kingdom')
      .map((entity) => ({ entity, distance: Phaser.Math.Distance.Between(x, y, entity.position.x, entity.position.y) }))
      .filter((item) => item.distance <= 50).sort((a, b) => a.distance - b.distance)[0]?.entity;
    if (target !== undefined) {
      this.engine.dispatch('human', { type: 'attack_target', playerId: 'player_kingdom', unitIds: [...this.selection.ids], targetId: target.id });
      this.showMarker(target.position.x, target.position.y, 0xd45545); return;
    }
    this.issueMove(x, y);
  }

  private issueMove(x: number, y: number): void {
    if (this.selection.kind !== 'units') return;
    const destination = { x: Math.round(Phaser.Math.Clamp(x, 20, WORLD_WIDTH - 20)), y: Math.round(Phaser.Math.Clamp(y, 20, WORLD_HEIGHT - 20)) };
    this.engine.dispatch('human', { type: 'move_units', playerId: 'player_kingdom', unitIds: [...this.selection.ids], destination });
    this.showMarker(destination.x, destination.y, 0xe1bd69); this.cancelArmedOrder();
  }

  private issueArmedUnitOrder(x: number, y: number): void {
    if (this.selection.kind !== 'units' || this.armedUnitOrder === undefined) return;
    const order = this.armedUnitOrder;
    if (order === 'move') { this.issueMove(x, y); return; }
    this.engine.dispatch('human', {
      type: 'issue_unit_order', playerId: 'player_kingdom', unitIds: [...this.selection.ids], order,
      destination: { x: Math.round(Phaser.Math.Clamp(x, 20, WORLD_WIDTH - 20)), y: Math.round(Phaser.Math.Clamp(y, 20, WORLD_HEIGHT - 20)) },
    });
    this.showMarker(x, y, order === 'retreat' ? 0x6eb6d8 : order === 'defend_area' ? 0x72c46b : 0xd99a4d);
    this.cancelArmedOrder();
  }

  private selectAt(x: number, y: number, pointer: Phaser.Input.Pointer): void {
    const world = this.queries.getWorldView('player_kingdom');
    const friendly = world.units
      .filter((unit) => unit.ownerId === 'player_kingdom')
      .map((unit) => ({ id: unit.id, distance: Phaser.Math.Distance.Between(x, y, unit.position.x, unit.position.y) }))
      .filter((item) => item.distance <= 24).sort((a, b) => a.distance - b.distance)[0];
    const additive = pointer.event instanceof MouseEvent && pointer.event.shiftKey;
    if (friendly !== undefined) {
      const unit = world.units.find((candidate) => candidate.id === friendly.id);
      const doubleClick = this.lastUnitClick?.id === friendly.id && this.time.now - this.lastUnitClick.at < 360;
      this.lastUnitClick = { id: friendly.id, at: this.time.now };
      if (doubleClick && unit !== undefined) {
        const ids = world.units.filter((candidate) => candidate.ownerId === 'player_kingdom' && candidate.type === unit.type &&
          Phaser.Math.Distance.Between(candidate.position.x, candidate.position.y, unit.position.x, unit.position.y) <= 520)
          .map((candidate) => candidate.id).sort();
        this.setSelection({ kind: 'units', ids }); return;
      }
      const current = additive && this.selection.kind === 'units' ? this.selection.ids : [];
      this.setSelection({ kind: 'units', ids: [...new Set([...current, friendly.id])] }); return;
    }
    const building = world.buildings
      .map((entity) => ({ entity, distance: Phaser.Math.Distance.Between(x, y, entity.position.x, entity.position.y) }))
      .filter((item) => item.distance <= BUILDINGS[item.entity.type].footprint + 12)
      .sort((a, b) => a.distance - b.distance)[0]?.entity;
    if (building !== undefined) { this.setSelection({ kind: 'building', id: building.id }); return; }
    const node = this.closestResource(world.resourceNodes, x, y);
    if (node !== undefined) { this.setSelection({ kind: 'resource', id: node.id }); return; }
    const site = world.strategicSites.map((entity) => ({ entity, distance: Phaser.Math.Distance.Between(x, y, entity.position.x, entity.position.y) }))
      .filter((item) => item.distance <= 55).sort((a, b) => a.distance - b.distance)[0]?.entity;
    if (site !== undefined) { this.setSelection({ kind: 'strategic', id: site.id }); return; }
    if (!additive) this.setSelection({ kind: 'none' });
  }

  private selectBox(start: Phaser.Math.Vector2, end: Phaser.Math.Vector2, pointer: Phaser.Input.Pointer): void {
    const a = this.cameras.main.getWorldPoint(start.x, start.y); const b = this.cameras.main.getWorldPoint(end.x, end.y);
    const rect = new Phaser.Geom.Rectangle(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    const ids = this.queries.getWorldView('player_kingdom').units
      .filter((unit) => unit.ownerId === 'player_kingdom' && rect.contains(unit.position.x, unit.position.y)).map((unit) => unit.id).sort();
    const current = pointer.event instanceof MouseEvent && pointer.event.shiftKey && this.selection.kind === 'units' ? this.selection.ids : [];
    const combined = [...new Set([...current, ...ids])];
    this.setSelection(combined.length === 0 ? { kind: 'none' } : { kind: 'units', ids: combined });
  }

  private closestResource(nodes: readonly ResourceNodeState[], x: number, y: number): ResourceNodeState | undefined {
    return nodes.filter((node) => node.remaining > 0)
      .map((node) => ({ node, distance: Phaser.Math.Distance.Between(x, y, node.position.x, node.position.y) }))
      .filter((item) => item.distance <= 60).sort((a, b) => a.distance - b.distance)[0]?.node;
  }

  private setSelection(selection: BattlefieldSelection): void {
    this.selection = selection.kind === 'units' ? { kind: 'units', ids: [...selection.ids].sort() } : { ...selection };
    this.cancelArmedOrder();
    for (const listener of this.listeners) listener(this.getSelection());
  }

  private createUnit(unit: UnitState): UnitView {
    const enemy = unit.ownerId !== 'player_kingdom';
    const ring = this.add.ellipse(0, 7, 30, 15, 0xc9aa62, 0.08).setStrokeStyle(1.5, 0xe5c875, 0.92).setVisible(false);
    const shadow = this.add.ellipse(0, 8, 20, 8, 0x111510, 0.32);
    let sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
    if (unit.type === 'villager' && this.textures.get('medieval-atlas').has('villager')) {
      sprite = this.add.image(0, 7, 'medieval-atlas', 'villager').setDisplaySize(54, 54).setOrigin(0.5, 0.82);
      if (enemy) sprite.setTint(0xe6aaa2);
    } else {
      const size = unit.type === 'catapult' || unit.type === 'battering_ram' ? 17 : unit.type === 'knight' ? 14 : 11;
      const colors: Record<UnitType, number> = {
        villager: 0x9c7448, swordsman: 0x607b91, spearman: 0x738b66, archer: 0x8a6b48,
        knight: 0x526d87, scout: 0x9a8055, catapult: 0x795b3d, battering_ram: 0x5d4a38,
      };
      sprite = this.add.rectangle(0, -2, size, size + 6, enemy ? 0x8d3632 : colors[unit.type]).setStrokeStyle(1, 0x1b201d);
    }
    const healthBg = this.add.rectangle(-14, -29, 28, 5, 0x101512, 0.88).setOrigin(0, 0.5).setStrokeStyle(1, 0x272d28).setVisible(false);
    const health = this.add.rectangle(-13, -29, 26, 3, enemy ? 0xd95b50 : 0x70b765).setOrigin(0, 0.5).setVisible(false);
    const equipment = this.add.graphics();
    const metal = enemy ? 0xd9a19b : 0xd7d3bd; const wood = 0x7b542f;
    if (unit.type === 'swordsman') equipment.lineStyle(3, metal).lineBetween(7, -14, 14, 5).lineStyle(2, 0x3b2b20).lineBetween(5, -4, 13, -7);
    if (unit.type === 'spearman') equipment.lineStyle(2, wood).lineBetween(8, 10, -9, -25).fillStyle(metal).fillTriangle(-9, -25, -6, -17, -13, -19);
    if (unit.type === 'archer') equipment.lineStyle(2, wood).beginPath().arc(4, -6, 11, -1.2, 1.2).strokePath().lineStyle(1, 0xd9c58d).lineBetween(8, -16, 8, 4);
    if (unit.type === 'knight' || unit.type === 'scout') {
      equipment.fillStyle(enemy ? 0x663c35 : unit.type === 'knight' ? 0x344d63 : 0x745f3d).fillEllipse(0, 6, unit.type === 'knight' ? 30 : 26, 13);
      equipment.fillCircle(11, 0, 5).lineStyle(2, 0x25231d).lineBetween(-8, 10, -9, 17).lineBetween(8, 10, 9, 17);
    }
    if (unit.type === 'catapult') equipment.fillStyle(wood).fillRect(-15, -7, 30, 13).fillStyle(0x28251f).fillCircle(-10, 9, 6).fillCircle(10, 9, 6).lineStyle(3, wood).lineBetween(0, -7, 11, -24);
    if (unit.type === 'battering_ram') equipment.fillStyle(wood).fillRoundedRect(-20, -10, 40, 17, 5).fillStyle(metal).fillTriangle(20, -10, 29, -2, 20, 7).fillStyle(0x28251f).fillCircle(-12, 9, 5).fillCircle(12, 9, 5);
    const container = this.add.container(unit.position.x, unit.position.y, [shadow, ring, equipment, sprite, healthBg, health]);
    const view = { container, sprite, ring, healthBg, health }; this.unitViews.set(unit.id, view); return view;
  }

  private createBuilding(building: BuildingState): BuildingView {
    const definition = BUILDINGS[building.type]; const enemy = building.ownerId !== 'player_kingdom';
    const width = definition.footprint * 2.35; const height = definition.footprint * 1.7;
    const ring = this.add.ellipse(0, 14, width + 12, height * 0.68, 0xc9aa62, 0.06).setStrokeStyle(2, 0xe5c875, 0.9).setVisible(false);
    const shadow = this.add.ellipse(0, 18, width * 0.9, height * 0.42, 0x101410, 0.32);
    let sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
    if (this.textures.get('medieval-atlas').has(building.type)) {
      sprite = this.add.image(0, 20, 'medieval-atlas', building.type).setDisplaySize(width, width).setOrigin(0.5, 0.72);
      if (enemy) sprite.setTint(0xe9aaa5);
    } else {
      // Debug fallback only; normal play loads the painted atlas.
      sprite = this.add.rectangle(0, 0, width, height, enemy ? 0x68433a : 0x8c7754).setStrokeStyle(2, 0x2e2921);
    }
    const progressBg = this.add.rectangle(0, height * 0.62, width, 6, 0x131713);
    const progress = this.add.rectangle(-width / 2, height * 0.62, width, 4, 0xd5af58).setOrigin(0, 0.5);
    const label = this.add.text(0, height * 0.82, definition.label, { fontFamily: 'Arial', fontSize: '10px', color: '#f5ebd2', backgroundColor: '#151915e8', padding: { x: 4, y: 2 } }).setOrigin(0.5).setVisible(false);
    sprite.setInteractive({ useHandCursor: true }).on('pointerover', () => label.setVisible(true)).on('pointerout', () => label.setVisible(false));
    const container = this.add.container(building.position.x, building.position.y, [shadow, ring, sprite, progressBg, progress, label]).setDepth(building.position.y);
    const view = { container, sprite, ring, progressBg, progress, label }; this.buildingViews.set(building.id, view); return view;
  }

  private createResource(node: ResourceNodeState): ResourceView {
    const hash = [...node.id].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 7);
    let sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Shape;
    if (this.textures.get('medieval-atlas').has(node.type)) {
      const size = node.type === 'wood' ? 96 : node.type === 'food' ? 68 : 76;
      sprite = this.add.image(0, 10, 'medieval-atlas', node.type).setDisplaySize(size, size).setOrigin(0.5, 0.84);
      sprite.setFlipX(hash % 2 === 0).setScale(sprite.scaleX * (0.9 + (hash % 17) / 100), sprite.scaleY * (0.9 + (hash % 17) / 100));
    } else {
      sprite = this.add.circle(0, 0, 26, node.type === 'wood' ? 0x315f39 : node.type === 'food' ? 0x94522e : node.type === 'iron' ? 0x4c5557 : 0x85867d);
    }
    const title = node.type === 'food' ? 'Berry Bush' : node.type === 'wood' ? 'Harvestable Tree' : node.type === 'iron' ? 'Iron Ore' : 'Stone Deposit';
    const label = this.add.text(0, 24, title, { fontFamily: 'Arial', fontSize: '9px', color: '#efe4c7', backgroundColor: '#172017e8', padding: { x: 4, y: 2 } }).setOrigin(0.5).setVisible(false);
    sprite.setInteractive({ useHandCursor: true }).on('pointerover', () => label.setVisible(true)).on('pointerout', () => label.setVisible(false));
    const container = this.add.container(node.position.x, node.position.y, [sprite, label]).setDepth(node.position.y + 25);
    const view = { container, sprite, label }; this.resourceViews.set(node.id, view); return view;
  }

  private createStrategicSite(site: StrategicSiteState): StrategicView {
    const ring = this.add.ellipse(0, 10, 92, 46).setStrokeStyle(3, 0xf1cc72).setVisible(false);
    const art = this.add.graphics().fillStyle(0x4a4b43, 1);
    if (site.type === 'abandoned_watch_tower') {
      art.fillRect(-18, -42, 36, 55).fillStyle(0x292c29).fillTriangle(-23, -42, 0, -65, 23, -42).fillStyle(0x242824).fillRect(-6, -12, 12, 25);
    } else if (site.type === 'ruined_fort') {
      art.fillRect(-38, -15, 76, 28).fillStyle(0x30332f).fillRect(-35, -36, 18, 23).fillRect(17, -29, 19, 16);
    } else {
      art.fillCircle(0, 0, 31).lineStyle(4, 0xc8ad67).strokeCircle(0, 0, 24).lineBetween(0, -38, 0, 9);
    }
    const progressBg = this.add.rectangle(0, 25, 74, 5, 0x121512);
    const progress = this.add.rectangle(-37, 25, 74, 4, 0xa99c7c).setOrigin(0, 0.5);
    const label = this.add.text(0, 35, site.label, { fontFamily: 'Arial', fontSize: '9px', color: '#efe4c7', backgroundColor: '#151915e8', padding: { x: 5, y: 3 } }).setOrigin(0.5).setVisible(false);
    art.setInteractive(new Phaser.Geom.Circle(0, -10, 52), Phaser.Geom.Circle.Contains)
      .on('pointerover', () => label.setVisible(true)).on('pointerout', () => label.setVisible(false));
    const container = this.add.container(site.position.x, site.position.y, [ring, art, progressBg, progress, label]).setDepth(site.position.y + 30);
    const view = { container, ring, progress, label }; this.strategicViews.set(site.id, view); return view;
  }

  private createPlacementGhost(type: BuildingType): void {
    this.clearPlacementGhost();
    const definition = BUILDINGS[type];
    this.placementFootprint = this.add.ellipse(0, 0, definition.footprint * 2, definition.footprint * 1.35, 0x63b96a, 0.22)
      .setStrokeStyle(3, 0x78d07a).setDepth(9_300);
    if (this.textures.get('medieval-atlas').has(type)) {
      this.placementSprite = this.add.image(0, 0, 'medieval-atlas', type).setDisplaySize(definition.footprint * 2.35, definition.footprint * 2.35)
        .setOrigin(0.5, 0.72).setAlpha(0.62).setDepth(9_301);
    }
    this.placementLabel = this.add.text(0, definition.footprint + 22, '', { fontFamily: 'Arial', fontSize: '10px', color: '#f2ead6', backgroundColor: '#131713e8', padding: { x: 5, y: 3 } })
      .setOrigin(0.5).setDepth(9_302);
  }

  private updatePlacementGhost(x: number, y: number): void {
    if (this.buildArmed === undefined) return;
    const position = { x: Math.round(x), y: Math.round(y) };
    const check = this.queries.checkBuildingPlacement('player_kingdom', this.buildArmed, position);
    const color = check.valid ? 0x70cf75 : 0xd4544c;
    this.placementFootprint?.setPosition(x, y).setFillStyle(color, 0.22).setStrokeStyle(3, color);
    this.placementSprite?.setPosition(x, y).setTint(check.valid ? 0xbce5b5 : 0xef8a82);
    this.placementLabel?.setPosition(x, y + BUILDINGS[this.buildArmed].footprint + 22).setText(check.valid ? 'CLICK TO BUILD' : check.message.toUpperCase());
  }

  private clearPlacementGhost(): void {
    this.placementSprite?.destroy(); this.placementSprite = undefined;
    this.placementFootprint?.destroy(); this.placementFootprint = undefined;
    this.placementLabel?.destroy(); this.placementLabel = undefined;
  }

  private drawTerrain(): void {
    if (this.textures.exists('battlefield-terrain')) {
      this.add.image(0, 0, 'battlefield-terrain').setOrigin(0).setDisplaySize(WORLD_WIDTH, WORLD_HEIGHT).setDepth(-10_000);
      return;
    }
    this.add.rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 0x65894e).setOrigin(0).setDepth(-10_000);
  }

  private createFogLayer(): void {
    const scale = 2;
    this.fogTexture = this.textures.createCanvas('battlefield-soft-fog', FOG_COLUMNS * scale, FOG_ROWS * scale);
    this.fogTexture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.fogSource = document.createElement('canvas');
    this.fogSource.width = FOG_COLUMNS * scale; this.fogSource.height = FOG_ROWS * scale;
    this.fog = this.add.image(0, 0, 'battlefield-soft-fog').setOrigin(0).setDisplaySize(WORLD_WIDTH, WORLD_HEIGHT).setDepth(9_000);
  }

  private updateFog(world: WorldView): void {
    const source = this.fogSource; const texture = this.fogTexture;
    if (source === undefined || texture === undefined) return;
    const sourceContext = source.getContext('2d');
    if (sourceContext === null) return;
    const scale = 2;
    sourceContext.clearRect(0, 0, source.width, source.height);
    for (let row = 0; row < world.fog.rows; row += 1) {
      for (let column = 0; column < world.fog.columns; column += 1) {
        const state = world.fog.cells[row * world.fog.columns + column] ?? 0;
        if (state === 2) continue;
        sourceContext.fillStyle = state === 0 ? 'rgba(3, 9, 7, .91)' : 'rgba(7, 13, 10, .54)';
        sourceContext.fillRect(column * scale, row * scale, scale, scale);
      }
    }
    const context = texture.context;
    context.clearRect(0, 0, texture.width, texture.height);
    context.save(); context.filter = 'blur(1.8px)'; context.drawImage(source, 0, 0); context.restore();
    texture.refresh();
  }

  private drawSelectionBox(sx: number, sy: number, ex: number, ey: number): void {
    const x = Math.min(sx, ex); const y = Math.min(sy, ey); const width = Math.abs(ex - sx); const height = Math.abs(ey - sy);
    this.selectionBox?.clear().fillStyle(0xc9aa62, 0.12).fillRect(x, y, width, height).lineStyle(1, 0xe2c878).strokeRect(x, y, width, height);
  }
  private showMarker(x: number, y: number, color: number): void {
    const marker = this.add.graphics().setDepth(9_500).setPosition(x, y);
    marker.fillStyle(color, 0.09).fillCircle(0, 0, 15).lineStyle(2, color, 0.95).strokeCircle(0, 0, 14)
      .lineStyle(1, 0xf4e4b6, 0.72).strokeCircle(0, 0, 8)
      .lineBetween(-21, 0, -12, 0).lineBetween(12, 0, 21, 0).lineBetween(0, -21, 0, -12).lineBetween(0, 12, 0, 21);
    this.tweens.add({ targets: marker, scale: 1.35, alpha: 0, duration: 680, ease: 'Sine.easeOut', onComplete: () => marker.destroy() });
  }
  private updateCamera(delta: number): void {
    const camera = this.cameras.main; const speed = 0.62 * delta / camera.zoom;
    if (this.cursorKeys?.left.isDown || this.wasd?.A.isDown) camera.scrollX -= speed;
    if (this.cursorKeys?.right.isDown || this.wasd?.D.isDown) camera.scrollX += speed;
    if (this.cursorKeys?.up.isDown || this.wasd?.W.isDown) camera.scrollY -= speed;
    if (this.cursorKeys?.down.isDown || this.wasd?.S.isDown) camera.scrollY += speed;
  }
  private readonly fitCamera = (): void => {
    const camera = this.cameras.main;
    this.minimumZoom = Math.max(camera.width / WORLD_WIDTH, camera.height / WORLD_HEIGHT, 0.48);
    camera.setZoom(Phaser.Math.Clamp(camera.zoom, this.minimumZoom, 1.45));
  };
}
