import { MAP_HEIGHT, MAP_WIDTH } from '../../game/config/battle';
import type { GameState } from '../../game/simulation/GameState';
import type { BattlePlan, ZoneId } from '../../game/types/domain';
import { Camera } from './Camera';
import { EffectsLayer } from './EffectsLayer';
import { FogLayer } from './FogLayer';
import { ObjectiveLayer } from './ObjectiveLayer';
import { PALETTE } from './palette';
import { PlanLayer } from './PlanLayer';
import { DetailedTerrainLayer } from './DetailedTerrainLayer';
import { UnitLayer } from './UnitLayer';
import type { RenderSnapshot } from './RenderSnapshot';

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
 * then the armies, then what they are doing, then the objective they are doing
 * it for, then what is merely proposed.
 */
export class Renderer {
  public readonly camera: Camera;
  public readonly selection = new Set<string>();
  public dragBox: DragBox | undefined;
  public hoveredZone: ZoneId | undefined;

  private readonly context: CanvasRenderingContext2D;
  // The tactical style uses the authored pixel terrain without the hundreds
  // of decorative props and animated flourishes of the archived full style.
  private readonly terrain = new DetailedTerrainLayer(undefined, 'terrain');
  private readonly fog = new FogLayer();
  private readonly units = new UnitLayer();
  private readonly effects = new EffectsLayer();
  private readonly plan = new PlanLayer();
  private readonly objective = new ObjectiveLayer();

  private devicePixelRatioCache = 1;

  public constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d', { alpha: false });
    if (context === null) throw new Error('Canvas 2D context unavailable.');
    this.context = context;
    this.camera = new Camera();
    this.resize();
  }

  /** The baked battlefield art, so the minimap can draw the same ground. */
  public get terrainArtwork(): HTMLCanvasElement {
    return this.terrain.artwork;
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

  public render(
    state: GameState,
    plan: BattlePlan | undefined,
    previous?: RenderSnapshot,
    interpolation = 1,
  ): void {
    const context = this.context;
    const ratio = this.devicePixelRatioCache;
    // Rebuilds the ground only when the battle is somewhere else; ordinarily free.
    this.terrain.syncTo(state.mapId);

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    // Letterboxing at whole-map command zoom should read as the edge of the
    // campaign table, not as two black holes beside the battlefield.
    context.fillStyle = '#141109';
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

    // The tick, not the frame clock, drives every animated thing on the ground.
    // Pausing the battle has to still the water and the banners with it.
    this.terrain.draw(context, this.camera, state.currentTick);
    this.fog.draw(context, this.camera, state);
    // Place names are handed to the unit layer so they land between the troops
    // and their labels: over a regiment's blocks, which would otherwise erase
    // the name of the ground it is standing on, and under the regiment's own
    // label, which the commander needs more than the name of the field.
    this.units.draw(context, this.camera, state, this.selection, previous, interpolation, () => {
      this.terrain.drawLabels(context, this.camera, this.hoveredZone);
    });
    this.effects.draw(context, this.camera, state, interpolation);
    // Above the armies: the objective must never be buried under a melee.
    this.objective.draw(context, this.camera, state);
    this.plan.draw(context, this.camera, state, plan);

    // The field has an edge. Outside it the canvas carries the same colour as
    // unexplored ground, so on a wide window the ends of the map read as a hole
    // in the drawing rather than as the end of the country being fought over.
    context.strokeStyle = PALETTE.mapEdge;
    context.lineWidth = 1 / this.camera.zoom;
    context.strokeRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

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

    // A marching pixel marquee rather than a hairline rectangle, so the drag
    // belongs to the same drawing as the rest of the field.
    context.fillStyle = PALETTE.selectionFill;
    context.fillRect(x, y, width, height);

    context.fillStyle = PALETTE.selection;
    const block = 3;
    for (let offset = 0; offset < width; offset += block * 2) {
      const run = Math.min(block, width - offset);
      context.fillRect(x + offset, y, run, block);
      context.fillRect(x + offset, y + height - block, run, block);
    }
    for (let offset = 0; offset < height; offset += block * 2) {
      const run = Math.min(block, height - offset);
      context.fillRect(x, y + offset, block, run);
      context.fillRect(x + width - block, y + offset, block, run);
    }
  }
}
