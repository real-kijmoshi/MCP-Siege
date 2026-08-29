import { FOG_COLUMNS, FOG_ROWS, MAP_HEIGHT, MAP_WIDTH } from '../../game/config/battle';
import type { GameState } from '../../game/simulation/GameState';
import type { Camera } from './Camera';

/**
 * Fog of war.
 *
 * The grid is tiny (160 x 100), so it is painted into an offscreen bitmap and
 * stretched over the map with smoothing on. That gives soft edges for free and
 * costs one scaled blit per frame instead of sixteen thousand rectangles.
 */
export class FogLayer {
  private readonly buffer: HTMLCanvasElement;
  private readonly bufferContext: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private lastUpdateTick = -1;

  public constructor() {
    this.buffer = document.createElement('canvas');
    this.buffer.width = FOG_COLUMNS;
    this.buffer.height = FOG_ROWS;
    const context = this.buffer.getContext('2d');
    if (context === null) throw new Error('Fog buffer context unavailable.');
    this.bufferContext = context;
    this.image = context.createImageData(FOG_COLUMNS, FOG_ROWS);
  }

  private refresh(state: GameState): void {
    // Vision only changes every few ticks, so there is no point repainting
    // the bitmap on every animation frame.
    if (state.currentTick === this.lastUpdateTick) return;
    this.lastUpdateTick = state.currentTick;

    const cells = state.visibility.player.cells;
    const data = this.image.data;

    for (let index = 0; index < cells.length; index += 1) {
      const offset = index * 4;
      const value = cells[index] ?? 0;
      data[offset] = 4;
      data[offset + 1] = 7;
      data[offset + 2] = 5;
      // Unexplored is opaque, explored is dimmed, currently seen is clear.
      data[offset + 3] = value === 0 ? 236 : value === 1 ? 118 : 0;
    }

    this.bufferContext.putImageData(this.image, 0, 0);
  }

  public draw(context: CanvasRenderingContext2D, camera: Camera, state: GameState): void {
    this.refresh(state);
    void camera;
    const smoothing = context.imageSmoothingEnabled;
    context.imageSmoothingEnabled = true;
    context.drawImage(this.buffer, 0, 0, MAP_WIDTH, MAP_HEIGHT);
    context.imageSmoothingEnabled = smoothing;
  }
}
