import { FACTION_PLAYER, type Vector2D } from '../../game/types/domain';
import { activeGroups, type GameState } from '../../game/simulation/GameState';
import { visibilityAt } from '../../game/simulation/Visibility';
import { zoneAt } from '../../game/simulation/Zones';
import type { SimulationEngine } from '../../game/simulation/Engine';
import type { Renderer } from './Renderer';
import type { Minimap } from './Minimap';

/**
 * Desktop strategy controls.
 *
 * Selection is group-first: clicking a soldier selects the regiment he belongs
 * to, because commanding thousands of men one at a time is exactly the problem
 * this game is about.
 */

export interface InputCallbacks {
  onSelectionChange: () => void;
  onTogglePause: () => void;
  onSpeedChange: (delta: number) => void;
  onOrderIssued: (summary: string) => void;
}

const PAN_SPEED = 26;
const CLICK_RADIUS = 90;
/** Pointer travel below which a button release still counts as a click. */
const CLICK_SLOP = 5;
const ZOOM_STEP = 1.35;

export class Input {
  private readonly pressedKeys = new Set<string>();
  private readonly controlGroups = new Map<string, string[]>();
  private panPointerId: number | undefined;
  private lastPointer: Vector2D = { x: 0, y: 0 };
  private dragStart: Vector2D | undefined;
  private dragging = false;
  private minimapDragging = false;
  /** Right button held: it pans, and only orders if it never moved. */
  private orderPointerId: number | undefined;
  private orderStart: Vector2D | undefined;
  private orderPanned = false;
  private cycleIndex = -1;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly minimapCanvas: HTMLCanvasElement,
    private readonly minimap: Minimap,
    private readonly renderer: Renderer,
    private readonly engine: SimulationEngine,
    private readonly callbacks: InputCallbacks,
  ) {
    this.attach();
  }

  private get state(): GameState {
    return this.engine.getState();
  }

  private attach(): void {
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });

    this.minimapCanvas.addEventListener('pointerdown', this.onMinimapDown);
    window.addEventListener('pointermove', this.onMinimapMove);
    window.addEventListener('pointerup', () => {
      this.minimapDragging = false;
    });

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  /* ------------------------------------------------------------- pointer */

  private localPoint(event: PointerEvent): Vector2D {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const point = this.localPoint(event);
    this.lastPointer = point;

    if (event.button === 1) {
      this.panPointerId = event.pointerId;
      event.preventDefault();
      return;
    }

    if (event.button === 0) {
      this.dragStart = point;
      this.dragging = false;
      return;
    }

    if (event.button === 2) {
      // Held and dragged, the right button pans; released in place, it orders.
      // Ordering on press meant there was no way to take back a misclick and
      // no second way to move the camera.
      this.orderPointerId = event.pointerId;
      this.orderStart = point;
      this.orderPanned = false;
      event.preventDefault();
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const point = this.localPoint(event);
    const rect = this.canvas.getBoundingClientRect();
    if (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    ) {
      const world = this.renderer.camera.screenToWorld(point.x, point.y);
      this.renderer.hoveredZone = zoneAt(world.x, world.y);
    } else {
      this.renderer.hoveredZone = undefined;
    }

    if (this.panPointerId === event.pointerId || this.orderPointerId === event.pointerId) {
      const camera = this.renderer.camera;
      if (this.orderPointerId === event.pointerId && this.orderStart !== undefined) {
        const travelled = Math.hypot(point.x - this.orderStart.x, point.y - this.orderStart.y);
        if (travelled > CLICK_SLOP) this.orderPanned = true;
        if (!this.orderPanned) {
          this.lastPointer = point;
          return;
        }
      }
      camera.panBy(
        (this.lastPointer.x - point.x) / camera.zoom,
        (this.lastPointer.y - point.y) / camera.zoom,
      );
      this.lastPointer = point;
      return;
    }

    this.lastPointer = point;

    if (this.dragStart === undefined) return;
    const travelled = Math.hypot(point.x - this.dragStart.x, point.y - this.dragStart.y);
    if (travelled > 4) this.dragging = true;
    if (this.dragging) {
      this.renderer.dragBox = {
        startX: this.dragStart.x,
        startY: this.dragStart.y,
        currentX: point.x,
        currentY: point.y,
      };
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.panPointerId === event.pointerId) {
      this.panPointerId = undefined;
      return;
    }

    if (this.orderPointerId === event.pointerId) {
      const start = this.orderStart;
      this.orderPointerId = undefined;
      this.orderStart = undefined;
      if (!this.orderPanned && start !== undefined) {
        this.issueContextOrder(this.localPoint(event), event.shiftKey, event.ctrlKey);
      }
      this.orderPanned = false;
      return;
    }

    if (this.dragStart === undefined) return;

    const point = this.localPoint(event);
    const additive = event.shiftKey;

    if (this.dragging) {
      this.selectWithin(this.dragStart, point, additive);
    } else {
      this.selectAt(point, additive);
    }

    this.dragStart = undefined;
    this.dragging = false;
    this.renderer.dragBox = undefined;
    this.callbacks.onSelectionChange();
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const factor = event.deltaY < 0 ? 1.14 : 1 / 1.14;
    this.renderer.camera.zoomAt(event.clientX - rect.left, event.clientY - rect.top, factor);
  };

  /* ------------------------------------------------------------ minimap */

  private readonly onMinimapDown = (event: PointerEvent): void => {
    this.minimapDragging = true;
    const world = this.minimap.toWorld(event.clientX, event.clientY);
    this.renderer.camera.centerOn(world.x, world.y);
  };

  private readonly onMinimapMove = (event: PointerEvent): void => {
    if (!this.minimapDragging) return;
    const world = this.minimap.toWorld(event.clientX, event.clientY);
    this.renderer.camera.centerOn(world.x, world.y);
  };

  /* ---------------------------------------------------------- selection */

  private selectAt(point: Vector2D, additive: boolean): void {
    const world = this.renderer.camera.screenToWorld(point.x, point.y);
    const groupId = this.groupNear(world);

    if (!additive) this.renderer.selection.clear();
    if (groupId === undefined) return;

    if (additive && this.renderer.selection.has(groupId)) this.renderer.selection.delete(groupId);
    else this.renderer.selection.add(groupId);
  }

  /** Nearest friendly soldier to the point, resolved to his regiment. */
  private groupNear(world: Vector2D): string | undefined {
    const state = this.state;
    const units = state.units;
    const reach = Math.max(CLICK_RADIUS, 26 / this.renderer.camera.zoom);

    let bestGroupSlot = -1;
    let bestDistance = reach * reach;

    for (let index = 0; index < units.count; index += 1) {
      if (units.alive[index] !== 1 || units.owner[index] !== FACTION_PLAYER) continue;
      const dx = (units.x[index] ?? 0) - world.x;
      const dy = (units.y[index] ?? 0) - world.y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestGroupSlot = units.group[index] ?? -1;
      }
    }

    if (bestGroupSlot < 0) {
      // Nothing under the cursor: fall back to a nearby group anchor, so
      // clicking the label or the gap inside a formation still selects it.
      for (const group of activeGroups(state, 'player')) {
        const dx = group.anchor.x - world.x;
        const dy = group.anchor.y - world.y;
        if (dx * dx + dy * dy < reach * reach) return group.id;
      }
      return undefined;
    }
    return state.groups[bestGroupSlot]?.id;
  }

  private selectWithin(from: Vector2D, to: Vector2D, additive: boolean): void {
    const camera = this.renderer.camera;
    const start = camera.screenToWorld(Math.min(from.x, to.x), Math.min(from.y, to.y));
    const end = camera.screenToWorld(Math.max(from.x, to.x), Math.max(from.y, to.y));

    if (!additive) this.renderer.selection.clear();

    const state = this.state;
    const units = state.units;
    const hit = new Set<number>();

    for (let index = 0; index < units.count; index += 1) {
      if (units.alive[index] !== 1 || units.owner[index] !== FACTION_PLAYER) continue;
      const x = units.x[index] ?? 0;
      const y = units.y[index] ?? 0;
      if (x < start.x || x > end.x || y < start.y || y > end.y) continue;
      hit.add(units.group[index] ?? -1);
    }

    for (const slot of hit) {
      const group = state.groups[slot];
      if (group !== undefined) this.renderer.selection.add(group.id);
    }
  }

  /* -------------------------------------------------------------- orders */

  private issueContextOrder(point: Vector2D, queue: boolean, assault: boolean): void {
    const selected = [...this.renderer.selection];
    if (selected.length === 0) {
      // Silence here read as a broken right-click. Say what is missing.
      this.callbacks.onOrderIssued('Select a regiment first, then right-click to order it.');
      return;
    }

    const world = this.renderer.camera.screenToWorld(point.x, point.y);

    if (assault) {
      // Attack-move: advance onto the ground and fight for it, rather than
      // marching past a defended crossing to reach an empty coordinate.
      const command = this.engine.dispatch('human', {
        type: 'order_groups',
        playerId: 'player',
        groupIds: selected,
        order: 'attack_zone',
        targetZone: zoneAt(world.x, world.y),
      });
      this.reportWhenApplied(command.id);
      return;
    }

    const enemyGroupId = this.visibleEnemyNear(world);

    if (enemyGroupId !== undefined) {
      const command = this.engine.dispatch('human', {
        type: 'order_groups',
        playerId: 'player',
        groupIds: selected,
        order: 'attack_group',
        targetGroupId: enemyGroupId,
      });
      this.reportWhenApplied(command.id);
      return;
    }

    if (queue) {
      const command = this.engine.dispatch('human', {
        type: 'order_groups',
        playerId: 'player',
        groupIds: selected,
        order: 'move',
        destination: { x: world.x, y: world.y },
        append: true,
      });
      this.reportWhenApplied(command.id);
      return;
    }

    const command = this.engine.dispatch('human', {
      type: 'order_groups',
      playerId: 'player',
      groupIds: selected,
      order: 'move',
      destination: { x: world.x, y: world.y },
    });
    this.reportWhenApplied(command.id);
  }

  private visibleEnemyNear(world: Vector2D): string | undefined {
    const state = this.state;
    const units = state.units;
    const reach = Math.max(CLICK_RADIUS, 26 / this.renderer.camera.zoom);
    let bestSlot = -1;
    let bestDistance = reach * reach;

    for (let index = 0; index < units.count; index += 1) {
      if (units.alive[index] !== 1 || units.owner[index] === FACTION_PLAYER) continue;
      const x = units.x[index] ?? 0;
      const y = units.y[index] ?? 0;
      if (visibilityAt(state, 'player', x, y) !== 2) continue;
      const dx = x - world.x;
      const dy = y - world.y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestSlot = units.group[index] ?? -1;
      }
    }
    return bestSlot < 0 ? undefined : state.groups[bestSlot]?.id;
  }

  private reportWhenApplied(commandId: string): void {
    // Commands resolve on the next tick, so read the result just after.
    const unsubscribe = this.engine.onCommandResult((command, result) => {
      if (command.id !== commandId) return;
      unsubscribe();
      this.callbacks.onOrderIssued(result.ok ? result.summary : result.message);
    });
  }

  /* ------------------------------------------------------------ keyboard */

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

    this.pressedKeys.add(event.key.toLowerCase());

    if (event.key.toLowerCase() === 'a' && (event.ctrlKey || event.metaKey)) {
      // 'a' is also pan-left, and it was just recorded as held. Drop it, or the
      // camera slides west for as long as the chord is down.
      this.pressedKeys.delete('a');
      this.selectAll();
      event.preventDefault();
      return;
    }

    if (event.key === 'Tab') {
      this.cycleSelection(event.shiftKey ? -1 : 1);
      event.preventDefault();
      return;
    }

    if (event.key >= '1' && event.key <= '9') {
      if (event.ctrlKey || event.metaKey) {
        this.controlGroups.set(event.key, [...this.renderer.selection]);
        this.callbacks.onOrderIssued(`Control group ${event.key} assigned.`);
      } else {
        const stored = this.controlGroups.get(event.key);
        if (stored !== undefined) {
          this.renderer.selection.clear();
          for (const id of stored) this.renderer.selection.add(id);
          this.callbacks.onSelectionChange();
          this.focusSelection();
        }
      }
      event.preventDefault();
      return;
    }

    switch (event.key.toLowerCase()) {
      case ' ':
        this.callbacks.onTogglePause();
        event.preventDefault();
        break;
      case 'f':
        this.focusSelection();
        break;
      case 'escape':
        this.renderer.selection.clear();
        this.callbacks.onSelectionChange();
        break;
      case 'z':
        this.zoomAtCentre(1 / ZOOM_STEP);
        break;
      case 'x':
        this.zoomAtCentre(ZOOM_STEP);
        break;
      case 'h': {
        // Home on the thing the whole battle is about.
        const king = this.state.objective.kings.player.position;
        this.renderer.camera.centerOn(king.x, king.y);
        break;
      }
      case '+':
      case '=':
        this.callbacks.onSpeedChange(1);
        break;
      case '-':
        this.callbacks.onSpeedChange(-1);
        break;
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.pressedKeys.delete(event.key.toLowerCase());
  };

  /** Every regiment still standing. The fastest way to move a whole army. */
  private selectAll(): void {
    this.renderer.selection.clear();
    for (const group of activeGroups(this.state, 'player')) this.renderer.selection.add(group.id);
    this.callbacks.onSelectionChange();
    this.callbacks.onOrderIssued(`${this.renderer.selection.size} regiments selected.`);
  }

  /**
   * Steps through the roster, centring on each in turn.
   *
   * On a battlefield several screens wide, hunting for a regiment by dragging
   * the minimap is the slowest thing a commander has to do.
   */
  private cycleSelection(direction: number): void {
    const groups = activeGroups(this.state, 'player');
    if (groups.length === 0) return;
    this.cycleIndex = (this.cycleIndex + direction + groups.length) % groups.length;
    const group = groups[this.cycleIndex];
    if (group === undefined) return;
    this.renderer.selection.clear();
    this.renderer.selection.add(group.id);
    this.callbacks.onSelectionChange();
    this.renderer.camera.centerOn(group.anchor.x, group.anchor.y);
  }

  private zoomAtCentre(factor: number): void {
    const camera = this.renderer.camera;
    camera.zoomAt(camera.viewportWidth / 2, camera.viewportHeight / 2, factor);
  }

  /** Centres on a named regiment. Used by the roster and the alert feed. */
  public focusGroup(groupId: string): void {
    const group = activeGroups(this.state, 'player').find((entry) => entry.id === groupId);
    if (group === undefined) return;
    this.renderer.camera.centerOn(group.anchor.x, group.anchor.y);
  }

  /** Centres on a world position. Used when an alert names a place. */
  public focusPoint(x: number, y: number): void {
    this.renderer.camera.centerOn(x, y);
  }

  public focusSelection(): void {
    const groups = activeGroups(this.state, 'player').filter((group) =>
      this.renderer.selection.has(group.id),
    );
    if (groups.length === 0) return;
    const x = groups.reduce((sum, group) => sum + group.anchor.x, 0) / groups.length;
    const y = groups.reduce((sum, group) => sum + group.anchor.y, 0) / groups.length;
    this.renderer.camera.centerOn(x, y);
  }

  /** Called once per animation frame so panning feels continuous. */
  public update(): void {
    const camera = this.renderer.camera;
    const step = PAN_SPEED / camera.zoom;
    let dx = 0;
    let dy = 0;
    if (this.pressedKeys.has('w') || this.pressedKeys.has('arrowup')) dy -= step;
    if (this.pressedKeys.has('s') || this.pressedKeys.has('arrowdown')) dy += step;
    if (this.pressedKeys.has('a') || this.pressedKeys.has('arrowleft')) dx -= step;
    if (this.pressedKeys.has('d') || this.pressedKeys.has('arrowright')) dx += step;
    if (dx !== 0 || dy !== 0) camera.panBy(dx, dy);
  }
}
