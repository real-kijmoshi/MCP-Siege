import { MAP_HEIGHT, MAP_WIDTH } from '../../game/config/battle';
import type { Vector2D } from '../../game/types/domain';

/**
 * World-to-screen transform.
 *
 * The renderer draws in world coordinates and lets the canvas transform do the
 * work, so a unit's position never has to be converted by hand. Anything drawn
 * with a fixed pixel size divides by `zoom` to compensate.
 */

export const MIN_ZOOM = 0.07;
export const MAX_ZOOM = 1.8;

export class Camera {
  /** World coordinate at the top-left of the viewport. */
  public x = 0;
  public y = 0;
  public zoom = 0.22;

  public viewportWidth = 1;
  public viewportHeight = 1;

  public constructor(centerOn: Vector2D = { x: MAP_WIDTH / 2, y: MAP_HEIGHT * 0.62 }) {
    this.x = centerOn.x;
    this.y = centerOn.y;
  }

  public setViewport(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    this.clamp();
  }

  public get worldWidth(): number {
    return this.viewportWidth / this.zoom;
  }

  public get worldHeight(): number {
    return this.viewportHeight / this.zoom;
  }

  public centerOn(x: number, y: number): void {
    this.x = x - this.worldWidth / 2;
    this.y = y - this.worldHeight / 2;
    this.clamp();
  }

  public get centerX(): number {
    return this.x + this.worldWidth / 2;
  }

  public get centerY(): number {
    return this.y + this.worldHeight / 2;
  }

  public panBy(worldDx: number, worldDy: number): void {
    this.x += worldDx;
    this.y += worldDy;
    this.clamp();
  }

  /** Zooms about a screen point, so the world under the cursor stays put. */
  public zoomAt(screenX: number, screenY: number, factor: number): void {
    const before = this.screenToWorld(screenX, screenY);
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    const after = this.screenToWorld(screenX, screenY);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }

  public screenToWorld(screenX: number, screenY: number): Vector2D {
    return { x: this.x + screenX / this.zoom, y: this.y + screenY / this.zoom };
  }

  public worldToScreen(worldX: number, worldY: number): Vector2D {
    return { x: (worldX - this.x) * this.zoom, y: (worldY - this.y) * this.zoom };
  }

  /**
   * Keeps the map on screen. When the viewport is wider than the world at the
   * current zoom, the map is centred rather than pinned to a corner.
   */
  private clamp(): void {
    const worldWidth = this.worldWidth;
    const worldHeight = this.worldHeight;

    this.x =
      worldWidth >= MAP_WIDTH
        ? (MAP_WIDTH - worldWidth) / 2
        : Math.max(0, Math.min(MAP_WIDTH - worldWidth, this.x));

    this.y =
      worldHeight >= MAP_HEIGHT
        ? (MAP_HEIGHT - worldHeight) / 2
        : Math.max(0, Math.min(MAP_HEIGHT - worldHeight, this.y));
  }

  /** Applies the transform; callers draw in world space afterwards. */
  public apply(context: CanvasRenderingContext2D): void {
    context.setTransform(this.zoom, 0, 0, this.zoom, -this.x * this.zoom, -this.y * this.zoom);
  }

  public get visibleBounds(): { left: number; top: number; right: number; bottom: number } {
    return {
      left: this.x,
      top: this.y,
      right: this.x + this.worldWidth,
      bottom: this.y + this.worldHeight,
    };
  }
}
