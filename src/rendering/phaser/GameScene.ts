import Phaser from 'phaser';
import { BUILDINGS, UNITS, WORLD_HEIGHT, WORLD_WIDTH } from '../../game/config/gameplay';
import type { SimulationEngine } from '../../game/simulation/Engine';
import type { BuildingState, BuildingType, ResourceNodeState, UnitState } from '../../game/types/domain';

export { WORLD_HEIGHT, WORLD_WIDTH };

export type BattlefieldSelection =
  | { kind: 'none' }
  | { kind: 'building'; id: string }
  | { kind: 'resource'; id: string }
  | { kind: 'units'; ids: string[] };
type SelectionListener = (selection: BattlefieldSelection) => void;
export interface CameraViewportProjection { left: number; top: number; width: number; height: number }

interface UnitView {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Rectangle;
  ring: Phaser.GameObjects.Ellipse;
  health: Phaser.GameObjects.Rectangle;
}
interface BuildingView {
  container: Phaser.GameObjects.Container;
  shell: Phaser.GameObjects.Rectangle;
  roof: Phaser.GameObjects.Triangle;
  ring: Phaser.GameObjects.Ellipse;
  progress: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

export class GameScene extends Phaser.Scene {
  private readonly unitViews = new Map<string, UnitView>();
  private readonly buildingViews = new Map<string, BuildingView>();
  private readonly resourceViews = new Map<string, Phaser.GameObjects.Container>();
  private readonly listeners = new Set<SelectionListener>();
  private selection: BattlefieldSelection = { kind: 'none' };
  private cursorKeys?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private dragStart: Phaser.Math.Vector2 | undefined;
  private selectionBox?: Phaser.GameObjects.Graphics;
  private moveArmed = false;
  private buildArmed: BuildingType | undefined;
  private minimumZoom = 0.6;
  private ready = false;

  public constructor(private readonly engine: SimulationEngine) { super('battlefield'); }

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
    this.moveArmed = true; this.buildArmed = undefined; this.game.canvas.classList.add('order-mode');
  }
  public armBuildingPlacement(type: BuildingType): void {
    if (this.selection.kind !== 'units') return;
    const snapshot = this.engine.getSnapshot();
    if (!this.selection.ids.every((id) => snapshot.villagers[id]?.ownerId === 'player_kingdom')) return;
    this.buildArmed = type; this.moveArmed = false; this.game.canvas.classList.add('order-mode');
  }
  public cancelArmedOrder(): void {
    this.moveArmed = false; this.buildArmed = undefined; this.game.canvas.classList.remove('order-mode');
  }
  public centerOnSelection(): void {
    const snapshot = this.engine.getSnapshot();
    let positions: Array<{ x: number; y: number }> = [];
    if (this.selection.kind === 'units') positions = this.selection.ids.map((id) => snapshot.units[id]?.position).filter((p) => p !== undefined);
    if (this.selection.kind === 'building') {
      const position = snapshot.buildings[this.selection.id]?.position; if (position !== undefined) positions = [position];
    }
    if (this.selection.kind === 'resource') {
      const position = snapshot.resourceNodes[this.selection.id]?.position; if (position !== undefined) positions = [position];
    }
    if (positions.length === 0) return;
    this.cameras.main.pan(positions.reduce((s, p) => s + p.x, 0) / positions.length, positions.reduce((s, p) => s + p.y, 0) / positions.length, 250, 'Sine.easeInOut');
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
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT).centerOn(535, 455);
    this.drawTerrain();
    const snapshot = this.engine.getSnapshot();
    for (const node of Object.values(snapshot.resourceNodes)) this.createResource(node);
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
      if (this.dragStart === undefined || !pointer.isDown || this.buildArmed !== undefined) return;
      this.drawSelectionBox(this.dragStart.x, this.dragStart.y, pointer.x, pointer.y);
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => this.handlePointerUp(pointer));
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      const camera = this.cameras.main;
      const before = camera.getWorldPoint(pointer.x, pointer.y);
      camera.setZoom(Phaser.Math.Clamp(camera.zoom - dy * 0.00085, this.minimumZoom, this.minimumZoom + 0.9));
      const after = camera.getWorldPoint(pointer.x, pointer.y);
      camera.scrollX += before.x - after.x; camera.scrollY += before.y - after.y;
    });
    this.selectTownHall();
  }

  public override update(_time: number, delta: number): void {
    this.updateCamera(delta);
    const snapshot = this.engine.getSnapshot();
    const selectedUnits = this.selection.kind === 'units' ? new Set(this.selection.ids) : new Set<string>();
    const activeUnits = new Set<string>();
    for (const unit of Object.values(snapshot.units)) {
      activeUnits.add(unit.id);
      const view = this.unitViews.get(unit.id) ?? this.createUnit(unit);
      view.container.x = Phaser.Math.Linear(view.container.x, unit.position.x, 0.18);
      view.container.y = Phaser.Math.Linear(view.container.y, unit.position.y, 0.18);
      view.container.setDepth(Math.round(view.container.y + 40));
      view.ring.setVisible(selectedUnits.has(unit.id));
      view.health.setScale(Math.max(0, unit.hitPoints / unit.maxHitPoints), 1);
    }
    for (const [id, view] of this.unitViews) if (!activeUnits.has(id)) { view.container.destroy(); this.unitViews.delete(id); }
    const activeBuildings = new Set<string>();
    for (const building of Object.values(snapshot.buildings)) {
      activeBuildings.add(building.id);
      const view = this.buildingViews.get(building.id) ?? this.createBuilding(building);
      const progress = building.constructionProgress / building.constructionRequired;
      view.shell.setAlpha(building.status === 'complete' ? 1 : 0.38 + progress * 0.5);
      view.roof.setAlpha(building.status === 'complete' ? 1 : 0.2 + progress * 0.7);
      view.ring.setVisible(this.selection.kind === 'building' && this.selection.id === building.id);
      view.progress.setVisible(building.status === 'blueprint').setScale(Math.max(0.02, progress), 1);
      view.label.setText(building.status === 'blueprint' ? `${BUILDINGS[building.type].label} ${Math.floor(progress * 100)}%` : BUILDINGS[building.type].label);
    }
    for (const [id, view] of this.buildingViews) if (!activeBuildings.has(id)) { view.container.destroy(); this.buildingViews.delete(id); }
    for (const node of Object.values(snapshot.resourceNodes)) this.resourceViews.get(node.id)?.setAlpha(node.remaining <= 0 ? 0.18 : 0.65 + 0.35 * node.remaining / node.capacity);
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    if (pointer.button === 2) { this.issueContextOrder(world.x, world.y); return; }
    if (pointer.button !== 0 || this.dragStart === undefined) return;
    if (this.buildArmed !== undefined && this.selection.kind === 'units') {
      const type = this.buildArmed;
      this.engine.dispatch('human', { type: 'place_building', playerId: 'player_kingdom', workerIds: [...this.selection.ids], buildingType: type, position: { x: Math.round(world.x), y: Math.round(world.y) } });
      this.showMarker(world.x, world.y, 0x6fbc70); this.cancelArmedOrder();
    } else {
      const distance = Phaser.Math.Distance.Between(this.dragStart.x, this.dragStart.y, pointer.x, pointer.y);
      if (distance > 9) this.selectBox(this.dragStart, new Phaser.Math.Vector2(pointer.x, pointer.y), pointer);
      else if (this.moveArmed) this.issueMove(world.x, world.y);
      else this.selectAt(world.x, world.y, pointer);
    }
    this.dragStart = undefined; this.selectionBox?.clear();
  }

  private issueContextOrder(x: number, y: number): void {
    if (this.selection.kind !== 'units') return;
    const snapshot = this.engine.getSnapshot();
    const targetNode = this.closestResource(snapshot.resourceNodes, x, y);
    const villagers = this.selection.ids.filter((id) => snapshot.villagers[id]?.ownerId === 'player_kingdom');
    if (targetNode !== undefined && villagers.length === this.selection.ids.length) {
      this.engine.dispatch('human', { type: 'gather_resource', playerId: 'player_kingdom', villagerIds: villagers, resourceNodeId: targetNode.id });
      this.showMarker(targetNode.position.x, targetNode.position.y, 0xe1bd69); return;
    }
    const target = [...Object.values(snapshot.units), ...Object.values(snapshot.buildings)]
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

  private selectAt(x: number, y: number, pointer: Phaser.Input.Pointer): void {
    const snapshot = this.engine.getSnapshot();
    const friendly = Object.values(snapshot.units)
      .filter((unit) => unit.ownerId === 'player_kingdom')
      .map((unit) => ({ id: unit.id, distance: Phaser.Math.Distance.Between(x, y, unit.position.x, unit.position.y) }))
      .filter((item) => item.distance <= 24).sort((a, b) => a.distance - b.distance)[0];
    const additive = pointer.event instanceof MouseEvent && pointer.event.shiftKey;
    if (friendly !== undefined) {
      const current = additive && this.selection.kind === 'units' ? this.selection.ids : [];
      this.setSelection({ kind: 'units', ids: [...new Set([...current, friendly.id])] }); return;
    }
    const building = Object.values(snapshot.buildings)
      .map((entity) => ({ entity, distance: Phaser.Math.Distance.Between(x, y, entity.position.x, entity.position.y) }))
      .filter((item) => item.distance <= BUILDINGS[item.entity.type].footprint + 12)
      .sort((a, b) => a.distance - b.distance)[0]?.entity;
    if (building !== undefined) { this.setSelection({ kind: 'building', id: building.id }); return; }
    const node = this.closestResource(snapshot.resourceNodes, x, y);
    if (node !== undefined) { this.setSelection({ kind: 'resource', id: node.id }); return; }
    if (!additive) this.setSelection({ kind: 'none' });
  }

  private selectBox(start: Phaser.Math.Vector2, end: Phaser.Math.Vector2, pointer: Phaser.Input.Pointer): void {
    const a = this.cameras.main.getWorldPoint(start.x, start.y); const b = this.cameras.main.getWorldPoint(end.x, end.y);
    const rect = new Phaser.Geom.Rectangle(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    const ids = Object.values(this.engine.getSnapshot().units)
      .filter((unit) => unit.ownerId === 'player_kingdom' && rect.contains(unit.position.x, unit.position.y)).map((unit) => unit.id).sort();
    const current = pointer.event instanceof MouseEvent && pointer.event.shiftKey && this.selection.kind === 'units' ? this.selection.ids : [];
    const combined = [...new Set([...current, ...ids])];
    this.setSelection(combined.length === 0 ? { kind: 'none' } : { kind: 'units', ids: combined });
  }

  private closestResource(nodes: Record<string, ResourceNodeState>, x: number, y: number): ResourceNodeState | undefined {
    return Object.values(nodes).filter((node) => node.remaining > 0)
      .map((node) => ({ node, distance: Phaser.Math.Distance.Between(x, y, node.position.x, node.position.y) }))
      .filter((item) => item.distance <= 65).sort((a, b) => a.distance - b.distance)[0]?.node;
  }

  private setSelection(selection: BattlefieldSelection): void {
    this.selection = selection.kind === 'units' ? { kind: 'units', ids: [...selection.ids].sort() } : { ...selection };
    this.cancelArmedOrder();
    for (const listener of this.listeners) listener(this.getSelection());
  }

  private createUnit(unit: UnitState): UnitView {
    const enemy = unit.ownerId !== 'player_kingdom';
    const ring = this.add.ellipse(0, 7, 27, 13).setStrokeStyle(2, 0xf1cc72).setVisible(false);
    const shadow = this.add.ellipse(0, 8, 20, 8, 0x111510, 0.35);
    const size = unit.type === 'catapult' || unit.type === 'battering_ram' ? 17 : unit.type === 'knight' ? 14 : 11;
    const body = this.add.rectangle(0, -2, size, size + 6, enemy ? 0x8d3632 : unit.type === 'villager' ? 0x9b7951 : 0x3d6282).setStrokeStyle(1, 0x1b201d);
    const head = this.add.circle(0, -13, 4, enemy ? 0x8c6551 : 0xd0a079);
    const health = this.add.rectangle(-12, -23, 24, 3, enemy ? 0xd95b50 : 0x70c66b).setOrigin(0, 0.5);
    const container = this.add.container(unit.position.x, unit.position.y, [shadow, ring, body, head, health]);
    const view = { container, body, ring, health }; this.unitViews.set(unit.id, view); return view;
  }

  private createBuilding(building: BuildingState): BuildingView {
    const definition = BUILDINGS[building.type]; const enemy = building.ownerId !== 'player_kingdom';
    const width = definition.footprint * 1.55; const height = definition.footprint * 1.15;
    const ring = this.add.ellipse(0, 12, width + 18, height * 0.75).setStrokeStyle(3, 0xf1cc72).setVisible(false);
    const shadow = this.add.ellipse(0, height * 0.34, width + 15, height * 0.52, 0x101410, 0.35);
    const shell = this.add.rectangle(0, 0, width, height, enemy ? 0x68433a : 0x8c7754).setStrokeStyle(3, 0x2e2921);
    const roof = this.add.triangle(0, -height * 0.55, -width * 0.58, height * 0.25, 0, -height * 0.34, width * 0.58, height * 0.25, enemy ? 0x6f272a : 0x4c3c2d).setStrokeStyle(2, 0x29251f);
    if (building.type === 'watch_tower') { shell.setSize(width * 0.65, height * 1.5); roof.setY(-height * 0.9); }
    if (building.type === 'wall' || building.type === 'gate') roof.setVisible(false);
    const progressBg = this.add.rectangle(0, height * 0.72, width, 6, 0x131713);
    const progress = this.add.rectangle(-width / 2, height * 0.72, width, 4, 0xd5af58).setOrigin(0, 0.5);
    const label = this.add.text(0, height * 0.95, definition.label, { fontFamily: 'Arial', fontSize: '10px', color: '#f5ebd2', backgroundColor: '#151915d9', padding: { x: 4, y: 2 } }).setOrigin(0.5);
    const container = this.add.container(building.position.x, building.position.y, [shadow, ring, shell, roof, progressBg, progress, label]).setDepth(building.position.y);
    const view = { container, shell, roof, ring, progress, label }; this.buildingViews.set(building.id, view); return view;
  }

  private createResource(node: ResourceNodeState): void {
    const parts: Phaser.GameObjects.GameObject[] = [];
    if (node.type === 'wood') {
      for (let i = 0; i < 9; i += 1) {
        parts.push(this.add.rectangle((i % 3 - 1) * 22, Math.floor(i / 3) * 18 - 18, 6, 30, 0x5b3d25));
        parts.push(this.add.circle((i % 3 - 1) * 22, Math.floor(i / 3) * 18 - 35, 15, 0x315f39));
      }
    } else if (node.type === 'food') {
      parts.push(this.add.ellipse(0, 0, 86, 55, 0x9c8744));
      for (let i = 0; i < 12; i += 1) parts.push(this.add.rectangle((i % 6 - 2.5) * 12, Math.floor(i / 6) * 18 - 8, 3, 24, 0xd1b24d));
    } else {
      const color = node.type === 'iron' ? 0x4c5557 : 0x85867d;
      parts.push(this.add.polygon(0, 0, [-45, 20, -30, -22, 0, -38, 38, -18, 48, 25, 5, 38], color).setStrokeStyle(2, 0x343833));
    }
    const label = this.add.text(0, 48, node.type === 'iron' ? 'IRON DEPOSIT' : node.type.toUpperCase(), { fontFamily: 'Arial', fontSize: '10px', color: '#efe4c7', backgroundColor: '#172017c9', padding: { x: 4, y: 2 } }).setOrigin(0.5);
    parts.push(label);
    this.resourceViews.set(node.id, this.add.container(node.position.x, node.position.y, parts).setDepth(node.position.y - 30));
  }

  private drawTerrain(): void {
    const ground = this.add.graphics();
    ground.fillStyle(0x65894e).fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    ground.fillStyle(0x789a59, 0.7).fillEllipse(650, 470, 1100, 700);
    ground.fillStyle(0x557b47, 0.8).fillEllipse(1300, 280, 570, 430);
    ground.fillStyle(0x86a565, 0.5).fillEllipse(860, 780, 980, 250);
    for (let index = 0; index < 280; index += 1) {
      const x = (index * 97 + 31) % WORLD_WIDTH; const y = (index * 139 + 47) % (WORLD_HEIGHT - 70);
      ground.lineStyle(1, index % 3 === 0 ? 0xb2c47f : 0x426b3c, 0.4).lineBetween(x, y, x + 4, y - 6);
    }
    const water = this.add.graphics();
    water.fillStyle(0x376f7b).fillRect(0, WORLD_HEIGHT - 55, WORLD_WIDTH, 55);
  }

  private drawSelectionBox(sx: number, sy: number, ex: number, ey: number): void {
    const x = Math.min(sx, ex); const y = Math.min(sy, ey); const w = Math.abs(ex - sx); const h = Math.abs(ey - sy);
    this.selectionBox?.clear().fillStyle(0xc9aa62, 0.12).fillRect(x, y, w, h).lineStyle(1, 0xe2c878).strokeRect(x, y, w, h);
  }
  private showMarker(x: number, y: number, color: number): void {
    const marker = this.add.graphics().setDepth(9_500).lineStyle(3, color).strokeCircle(0, 0, 15).setPosition(x, y);
    this.tweens.add({ targets: marker, scale: 1.5, alpha: 0, duration: 800, onComplete: () => marker.destroy() });
  }
  private updateCamera(delta: number): void {
    const camera = this.cameras.main; const speed = 0.5 * delta / camera.zoom;
    if (this.cursorKeys?.left.isDown || this.wasd?.A.isDown) camera.scrollX -= speed;
    if (this.cursorKeys?.right.isDown || this.wasd?.D.isDown) camera.scrollX += speed;
    if (this.cursorKeys?.up.isDown || this.wasd?.W.isDown) camera.scrollY -= speed;
    if (this.cursorKeys?.down.isDown || this.wasd?.S.isDown) camera.scrollY += speed;
  }
  private readonly fitCamera = (): void => {
    const camera = this.cameras.main;
    this.minimumZoom = Math.max(camera.width / WORLD_WIDTH, camera.height / WORLD_HEIGHT, 0.58);
    camera.setZoom(Phaser.Math.Clamp(camera.zoom, this.minimumZoom, 1.7));
  };
}
