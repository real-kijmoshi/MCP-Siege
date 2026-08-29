import type { GameState } from '../../game/simulation/GameState';
import type { BattlePlan } from '../../game/types/domain';
import { Camera } from './Camera';
import { EffectsLayer } from './EffectsLayer';
import { FogLayer } from './FogLayer';
import { PALETTE } from './palette';
import { PlanLayer } from './PlanLayer';
import { TerrainLayer } from './TerrainLayer';
import { UnitLayer } from './UnitLayer';

export interface DragBox {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

/**
 * Frame composition.
 *
 * Reads live simulation state directly and draws it; it never writes. Layers
 * are ordered so the battlefield reads bottom-up: ground, then what is hidden,
 * then the armies, then what they are doing, then what is merely proposed.
 */
export class Renderer {
  public readonly camera: Camera;
  public readonly selection = new Set<string>();
  public dragBox: DragBox | undefined;

  private readonly context: CanvasRenderingContext2D;
  private readonly terrain = new TerrainLayer();
  private readonly fog = new FogLayer();
  private readonly units = new UnitLayer();
  private readonly effects = new EffectsLayer();
  private readonly plan = new PlanLayer();

  private devicePixelRatioCache = 1;

  public constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d', { alpha: false });
    if (context === null) throw new Error('Canvas 2D context unavailable.');
    this.context = context;
    this.camera = new Camera();
    this.resize();
  }

  public resize(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.devicePixelRatioCache = ratio;
    this.canvas.width = Math.max(1, Math.round(width * ratio));
    this.canvas.height = Math.max(1, Math.round(height * ratio));
    this.camera.setViewport(width, height);
  }

  public render(state: GameState, plan: BattlePlan | undefined): void {
    const context = this.context;
    const ratio = this.devicePixelRatioCache;

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = PALETTE.fogUnexplored;
    context.fillRect(0, 0, this.camera.viewportWidth, this.camera.viewportHeight);

    // World space from here on: the camera transform includes the pixel ratio.
    context.setTransform(
      this.camera.zoom * ratio,
      0,
      0,
      this.camera.zoom * ratio,
      -this.camera.x * this.camera.zoom * ratio,
      -this.camera.y * this.camera.zoom * ratio,
    );

    this.terrain.draw(context, this.camera);
    this.terrain.drawLabels(context, this.camera);
    this.fog.draw(context, this.camera, state);
    this.units.draw(context, this.camera, state, this.selection);
    this.effects.draw(context, this.camera, state);
    this.plan.draw(context, this.camera, state, plan);

    // Screen space for the marquee and the plan legend.
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.plan.drawLegend(context, this.camera, state, plan);
    this.drawDragBox(context);
  }

  private drawDragBox(context: CanvasRenderingContext2D): void {
    const box = this.dragBox;
    if (box === undefined) return;

    const x = Math.min(box.startX, box.currentX);
    const y = Math.min(box.startY, box.currentY);
    const width = Math.abs(box.currentX - box.startX);
    const height = Math.abs(box.currentY - box.startY);
    if (width < 3 && height < 3) return;

    context.fillStyle = PALETTE.selectionFill;
    context.strokeStyle = PALETTE.selection;
    context.lineWidth = 1.5;
    context.fillRect(x, y, width, height);
    context.strokeRect(x, y, width, height);
  }
}
