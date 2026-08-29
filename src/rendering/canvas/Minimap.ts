import { FOG_COLUMNS, FOG_ROWS, MAP_HEIGHT, MAP_WIDTH } from '../../game/config/battle';
import { activeGroups, type GameState } from '../../game/simulation/GameState';
import { visibilityAt } from '../../game/simulation/Visibility';
import { CROSSINGS, RIVER_HALF_WIDTH, riverCenterY } from '../../game/simulation/Zones';
import type { Camera } from './Camera';
import { PALETTE } from './palette';

/**
 * The minimap.
 *
 * Draws groups as blobs rather than units, refreshes at a low rate, and doubles
 * as the fastest way to move the camera across a battlefield this large.
 */
export class Minimap {
  private readonly context: CanvasRenderingContext2D;
  private readonly fogBuffer: HTMLCanvasElement;
  private readonly fogContext: CanvasRenderingContext2D;
  private readonly fogImage: ImageData;
  private lastDrawTick = -100;

  public constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Minimap context unavailable.');
    this.context = context;

    this.fogBuffer = document.createElement('canvas');
    this.fogBuffer.width = FOG_COLUMNS;
    this.fogBuffer.height = FOG_ROWS;
    const fogContext = this.fogBuffer.getContext('2d');
    if (fogContext === null) throw new Error('Minimap fog context unavailable.');
    this.fogContext = fogContext;
    this.fogImage = fogContext.createImageData(FOG_COLUMNS, FOG_ROWS);

    this.resize();
  }

  public resize(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    this.canvas.height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    this.lastDrawTick = -100;
  }

  /** Converts a click on the minimap into a world position. */
  public toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const fx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const fy = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return { x: fx * MAP_WIDTH, y: fy * MAP_HEIGHT };
  }

  public draw(state: GameState, camera: Camera): void {
    // Five refreshes a second is plenty for an overview at this size.
    if (state.currentTick - this.lastDrawTick < 4) return;
    this.lastDrawTick = state.currentTick;

    const context = this.context;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const scaleX = width / MAP_WIDTH;
    const scaleY = height / MAP_HEIGHT;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.grass;
    context.fillRect(0, 0, width, height);

    // River.
    context.fillStyle = PALETTE.river;
    context.beginPath();
    context.moveTo(0, (riverCenterY(0) - RIVER_HALF_WIDTH) * scaleY);
    for (let x = 0; x <= MAP_WIDTH; x += 200) {
      context.lineTo(x * scaleX, (riverCenterY(x) - RIVER_HALF_WIDTH) * scaleY);
    }
    for (let x = MAP_WIDTH; x >= 0; x -= 200) {
      context.lineTo(x * scaleX, (riverCenterY(x) + RIVER_HALF_WIDTH) * scaleY);
    }
    context.closePath();
    context.fill();

    context.fillStyle = PALETTE.crossing;
    for (const crossing of CROSSINGS) {
      const centerY = riverCenterY(crossing.center.x);
      context.fillRect(
        (crossing.center.x - crossing.radius * 0.62) * scaleX,
        (centerY - RIVER_HALF_WIDTH) * scaleY,
        crossing.radius * 1.24 * scaleX,
        RIVER_HALF_WIDTH * 2 * scaleY,
      );
    }

    // Fog.
    const cells = state.visibility.player.cells;
    const data = this.fogImage.data;
    for (let index = 0; index < cells.length; index += 1) {
      const offset = index * 4;
      const value = cells[index] ?? 0;
      data[offset] = 4;
      data[offset + 1] = 7;
      data[offset + 2] = 5;
      data[offset + 3] = value === 0 ? 230 : value === 1 ? 110 : 0;
    }
    this.fogContext.putImageData(this.fogImage, 0, 0);
    context.imageSmoothingEnabled = true;
    context.drawImage(this.fogBuffer, 0, 0, width, height);

    // Groups as blobs, sized by strength.
    for (const group of activeGroups(state)) {
      const isPlayer = group.ownerId === 'player';
      if (!isPlayer && visibilityAt(state, 'player', group.anchor.x, group.anchor.y) !== 2) continue;

      context.fillStyle = isPlayer ? PALETTE.player : PALETTE.enemy;
      const radius = Math.max(2, Math.sqrt(group.members.length) * 0.22);
      context.beginPath();
      context.arc(group.anchor.x * scaleX, group.anchor.y * scaleY, radius, 0, Math.PI * 2);
      context.fill();
    }

    // The objectives, on top of everything. At this size they are the only
    // things worth picking out by eye, so they are drawn as gold diamonds and
    // never hidden behind a blob.
    this.drawKings(state, scaleX, scaleY);

    // Camera viewport.
    const bounds = camera.visibleBounds;
    context.strokeStyle = 'rgba(240, 246, 240, 0.75)';
    context.lineWidth = 1.5;
    context.strokeRect(
      bounds.left * scaleX,
      bounds.top * scaleY,
      (bounds.right - bounds.left) * scaleX,
      (bounds.bottom - bounds.top) * scaleY,
    );
  }

  /** Own king always; the enemy's only where he has actually been seen. */
  private drawKings(state: GameState, scaleX: number, scaleY: number): void {
    const context = this.context;
    const own = state.objective.kings.player;
    const foe = state.objective.kings.enemy;

    const marks: Array<{ at: { x: number; y: number }; threatened: boolean; faded: boolean }> = [
      { at: own.position, threatened: own.captureProgress > 0, faded: false },
    ];

    if (visibilityAt(state, 'player', foe.position.x, foe.position.y) === 2) {
      marks.push({ at: foe.position, threatened: foe.captureProgress > 0, faded: false });
    } else if (foe.lastSightingByOpponent !== undefined) {
      marks.push({ at: foe.lastSightingByOpponent.position, threatened: false, faded: true });
    }

    for (const mark of marks) {
      const x = mark.at.x * scaleX;
      const y = mark.at.y * scaleY;
      context.globalAlpha = mark.faded ? 0.45 : 1;
      context.fillStyle = mark.threatened ? PALETTE.kingDanger : PALETTE.kingGold;
      context.beginPath();
      context.moveTo(x, y - 5);
      context.lineTo(x + 4, y);
      context.lineTo(x, y + 5);
      context.lineTo(x - 4, y);
      context.closePath();
      context.fill();
      context.strokeStyle = 'rgba(10, 8, 4, 0.9)';
      context.lineWidth = 1;
      context.stroke();
    }
    context.globalAlpha = 1;
  }
}
