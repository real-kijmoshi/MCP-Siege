import { MAP_HEIGHT, MAP_WIDTH } from '../../game/config/battle';
import type { TerrainKind } from '../../game/config/maps';
import type { GameState } from '../../game/simulation/GameState';
import { ZONES } from '../../game/simulation/Zones';
import type { BattlePlan, ZoneId } from '../../game/types/domain';
import { Camera } from './Camera';
import { EffectsLayer } from './EffectsLayer';
import { FogLayer } from './FogLayer';
import { ObjectiveLayer } from './ObjectiveLayer';
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
 * then the armies, then what they are doing, then the objective they are doing
 * it for, then what is merely proposed.
 */
export class Renderer {
  public readonly camera: Camera;
  public readonly selection = new Set<string>();
  public dragBox: DragBox | undefined;
  public hoveredZone: ZoneId | undefined;

  private readonly context: CanvasRenderingContext2D;
  private readonly terrain = new TerrainLayer();
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
    // Rebuilds the ground only when the battle is somewhere else; ordinarily free.
    this.terrain.syncTo(state.mapId);

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    // Letterboxing at whole-map command zoom should read as the edge of the
    // campaign table, not as two black holes beside the battlefield.
    context.fillStyle = '#111a14';
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
    this.terrain.drawLabels(context, this.camera, this.hoveredZone);
    this.fog.draw(context, this.camera, state);
    this.units.draw(context, this.camera, state, this.selection);
    this.effects.draw(context, this.camera, state);
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
    this.drawTerrainCard(context);
    this.drawDragBox(context);
  }

  private drawTerrainCard(context: CanvasRenderingContext2D): void {
    const id = this.hoveredZone;
    if (id === undefined || this.dragBox !== undefined) return;
    const zone = ZONES[id];
    const tips: Record<TerrainKind, string> = {
      open: 'Fast movement · exposed to missiles and cavalry',
      forest: 'Concealment · blunts cavalry and ranged fire',
      hill: 'High ground · stronger defense and missile reach',
      village: 'Hard cover · excellent ground to hold',
      crossing: 'Choke point · columns move through fastest',
      river: 'Impassable except at marked crossings',
      ridge: 'Impassable rock except through a gap',
    };
    const width = Math.min(360, this.camera.viewportWidth - 32);
    const x = this.camera.viewportWidth - width - 18;
    const y = 18;
    context.fillStyle = 'rgba(7, 15, 10, 0.92)';
    context.strokeStyle = zone.crossing ? PALETTE.crossingLabel : PALETTE.zoneRing;
    context.lineWidth = 1;
    context.fillRect(x, y, width, 82);
    context.strokeRect(x + 0.5, y + 0.5, width - 1, 81);

    context.textAlign = 'left';
    context.textBaseline = 'top';
    context.font = '700 12px ui-monospace, "SF Mono", Menlo, monospace';
    context.fillStyle = zone.crossing ? PALETTE.crossingLabel : PALETTE.zoneLabel;
    context.fillText(`${zone.name.toUpperCase()}  ·  ${zone.terrain.toUpperCase()}`, x + 13, y + 11);
    context.font = '500 11px ui-monospace, "SF Mono", Menlo, monospace';
    context.fillStyle = '#b7c9b9';
    context.fillText(tips[zone.terrain], x + 13, y + 31);
    context.fillStyle = '#7f9784';
    const description = zone.description.length > 52 ? `${zone.description.slice(0, 51)}…` : zone.description;
    context.fillText(description, x + 13, y + 52);
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
