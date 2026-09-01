import { FOG_COLUMNS, FOG_ROWS, MAP_HEIGHT, MAP_WIDTH } from '../../game/config/battle';
import type { GameState } from '../../game/simulation/GameState';
import type { Camera } from './Camera';

/**
 * Fog of war.
 *
 * The grid is tiny (160 x 100), so it is painted into an offscreen bitmap and
 * stretched over the map with smoothing on. That gives soft edges for free and
 * costs one scaled blit per frame instead of sixteen thousand rectangles.
 *
 * The veil is deliberately translucent rather than opaque. Fog hides *forces*,
 * not *ground*: a commander knows the valley he is defending, and blacking the
 * terrain out made the strategic view an unreadable void that no plan could be
 * drawn on. Enemy units and contacts are still gated by `visibilityAt`, so the
 * intelligence contract is untouched — only the picture of the earth changes.
 */

/** Ground never scouted: heavy haze, but the shape of the land still reads. */
const UNEXPLORED_ALPHA = 112;
/** Ground seen once and since lost: a light dusk, so memory reads as memory. */
const EXPLORED_ALPHA = 48;

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
      // A cold blue-grey rather than black: it reads as distance and weather,
      // which is what fog is, instead of as a hole in the world.
      data[offset] = 9;
      data[offset + 1] = 13;
      data[offset + 2] = 16;
      data[offset + 3] = value === 0 ? UNEXPLORED_ALPHA : value === 1 ? EXPLORED_ALPHA : 0;
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
