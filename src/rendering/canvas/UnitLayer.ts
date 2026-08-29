import { UNIT_CATEGORIES, FACTION_PLAYER, type UnitCategory } from '../../game/types/domain';
import { activeGroups, type GameState } from '../../game/simulation/GameState';
import { visibilityAt } from '../../game/simulation/Visibility';
import type { Camera } from './Camera';
import { PALETTE, moraleColor } from './palette';

/**
 * Drawing the armies.
 *
 * The whole budget lives here, so units are batched by faction and category
 * into preallocated buffers and drawn with one fill per batch: fourteen fills
 * for eight thousand men. Level of detail switches to blocks and then to group
 * blobs as the camera pulls back, which is what keeps a huge battle legible
 * rather than turning it into noise.
 */

const CATEGORY_COUNT = UNIT_CATEGORIES.length;
const BATCH_COUNT = CATEGORY_COUNT * 2;
const CAPACITY = 10_000;

/** Zoom below which individual men become blocks, then groups become blobs. */
const DETAIL_ZOOM = 0.5;
const BLOB_ZOOM = 0.155;

const SHAPE: Record<UnitCategory, 'square' | 'circle' | 'triangle' | 'diamond'> = {
  infantry: 'square',
  spearman: 'square',
  heavy_infantry: 'square',
  archer: 'circle',
  scout: 'circle',
  cavalry: 'triangle',
  siege: 'diamond',
};

const SIZE: Record<UnitCategory, number> = {
  infantry: 9,
  spearman: 9,
  heavy_infantry: 11,
  archer: 8,
  scout: 7,
  cavalry: 13,
  siege: 17,
};

/** Three shades per side keep categories distinguishable without a rainbow. */
function colorFor(faction: number, category: UnitCategory): string {
  const player = faction === FACTION_PLAYER;
  switch (category) {
    case 'heavy_infantry':
    case 'siege':
      return player ? PALETTE.playerDark : PALETTE.enemyDark;
    case 'archer':
    case 'scout':
    case 'cavalry':
      return player ? PALETTE.playerLight : PALETTE.enemyLight;
    default:
      return player ? PALETTE.player : PALETTE.enemy;
  }
}

export class UnitLayer {
  private readonly batchX: Float32Array[] = [];
  private readonly batchY: Float32Array[] = [];
  private readonly batchCount = new Int32Array(BATCH_COUNT);

  public constructor() {
    for (let batch = 0; batch < BATCH_COUNT; batch += 1) {
      this.batchX.push(new Float32Array(CAPACITY));
      this.batchY.push(new Float32Array(CAPACITY));
    }
  }

  public draw(
    context: CanvasRenderingContext2D,
    camera: Camera,
    state: GameState,
    selected: ReadonlySet<string>,
  ): void {
    if (camera.zoom < BLOB_ZOOM) {
      this.drawBlobs(context, camera, state, selected);
      return;
    }

    this.fillBatches(camera, state);

    const detailed = camera.zoom >= DETAIL_ZOOM;
    for (let batch = 0; batch < BATCH_COUNT; batch += 1) {
      const count = this.batchCount[batch] ?? 0;
      if (count === 0) continue;

      const faction = batch < CATEGORY_COUNT ? 0 : 1;
      const category = UNIT_CATEGORIES[batch % CATEGORY_COUNT] as UnitCategory;
      const xs = this.batchX[batch];
      const ys = this.batchY[batch];
      if (xs === undefined || ys === undefined) continue;

      context.fillStyle = colorFor(faction, category);
      context.beginPath();

      if (detailed) {
        this.addDetailedShapes(context, SHAPE[category], SIZE[category], xs, ys, count);
      } else {
        // Below the detail threshold every man is the same small block; shape
        // is no longer readable, but density and colour still are.
        const size = Math.max(2.5 / camera.zoom, SIZE[category] * 0.8);
        const half = size / 2;
        for (let n = 0; n < count; n += 1) {
          context.rect((xs[n] ?? 0) - half, (ys[n] ?? 0) - half, size, size);
        }
      }
      context.fill();
    }

    this.drawGroupMarkers(context, camera, state, selected);
  }

  private addDetailedShapes(
    context: CanvasRenderingContext2D,
    shape: 'square' | 'circle' | 'triangle' | 'diamond',
    size: number,
    xs: Float32Array,
    ys: Float32Array,
    count: number,
  ): void {
    const half = size / 2;
    for (let n = 0; n < count; n += 1) {
      const x = xs[n] ?? 0;
      const y = ys[n] ?? 0;
      switch (shape) {
        case 'square':
          context.rect(x - half, y - half, size, size);
          break;
        case 'circle':
          // moveTo first, or the arcs chain together into one long path.
          context.moveTo(x + half, y);
          context.arc(x, y, half, 0, Math.PI * 2);
          break;
        case 'triangle':
          context.moveTo(x, y - half);
          context.lineTo(x + half, y + half);
          context.lineTo(x - half, y + half);
          context.closePath();
          break;
        case 'diamond':
          context.moveTo(x, y - half);
          context.lineTo(x + half, y);
          context.lineTo(x, y + half);
          context.lineTo(x - half, y);
          context.closePath();
          break;
      }
    }
  }

  /** One pass over the pool, bucketing visible units into per-batch buffers. */
  private fillBatches(camera: Camera, state: GameState): void {
    this.batchCount.fill(0);

    const units = state.units;
    const bounds = camera.visibleBounds;
    const margin = 60;
    const left = bounds.left - margin;
    const right = bounds.right + margin;
    const top = bounds.top - margin;
    const bottom = bounds.bottom + margin;

    for (let index = 0; index < units.count; index += 1) {
      if (units.alive[index] !== 1) continue;

      const x = units.x[index] ?? 0;
      if (x < left || x > right) continue;
      const y = units.y[index] ?? 0;
      if (y < top || y > bottom) continue;

      const faction = units.owner[index] ?? 0;
      // The enemy is drawn only where the player can actually see them.
      if (faction !== FACTION_PLAYER && visibilityAt(state, 'player', x, y) !== 2) continue;

      const batch = (faction === FACTION_PLAYER ? 0 : CATEGORY_COUNT) + (units.category[index] ?? 0);
      const slot = this.batchCount[batch] ?? 0;
      if (slot >= CAPACITY) continue;
      const xs = this.batchX[batch];
      const ys = this.batchY[batch];
      if (xs === undefined || ys === undefined) continue;
      xs[slot] = x;
      ys[slot] = y;
      this.batchCount[batch] = slot + 1;
    }
  }

  /**
   * Far out, individual men are sub-pixel. Each group collapses to a single
   * blob sized by its strength, which is the view a commander actually wants.
   */
  private drawBlobs(
    context: CanvasRenderingContext2D,
    camera: Camera,
    state: GameState,
    selected: ReadonlySet<string>,
  ): void {
    for (const group of activeGroups(state)) {
      const isPlayer = group.ownerId === 'player';
      if (!isPlayer && visibilityAt(state, 'player', group.anchor.x, group.anchor.y) !== 2) continue;

      const radius = Math.max(28, Math.sqrt(group.members.length) * 9);
      context.fillStyle = isPlayer ? PALETTE.player : PALETTE.enemy;
      context.globalAlpha = 0.82;
      context.beginPath();
      context.arc(group.anchor.x, group.anchor.y, radius, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;

      if (selected.has(group.id)) {
        context.strokeStyle = PALETTE.selection;
        context.lineWidth = 3 / camera.zoom;
        context.beginPath();
        context.arc(group.anchor.x, group.anchor.y, radius + 12 / camera.zoom, 0, Math.PI * 2);
        context.stroke();
      }
    }
    this.drawGroupMarkers(context, camera, state, selected);
  }

  /** Name, strength and morale above each friendly group, plus selection rings. */
  private drawGroupMarkers(
    context: CanvasRenderingContext2D,
    camera: Camera,
    state: GameState,
    selected: ReadonlySet<string>,
  ): void {
    const bounds = camera.visibleBounds;
    const fontSize = 13 / camera.zoom;
    context.font = `600 ${fontSize}px ui-monospace, "SF Mono", Menlo, monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'bottom';

    for (const group of activeGroups(state)) {
      const isPlayer = group.ownerId === 'player';
      const { x, y } = group.anchor;
      if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) continue;
      if (!isPlayer && visibilityAt(state, 'player', x, y) !== 2) continue;

      const spread = Math.max(40, Math.sqrt(group.members.length) * 8);
      const labelY = y - spread - 10 / camera.zoom;

      if (selected.has(group.id)) {
        context.strokeStyle = PALETTE.selection;
        context.lineWidth = 2.5 / camera.zoom;
        context.beginPath();
        context.arc(x, y, spread + 14 / camera.zoom, 0, Math.PI * 2);
        context.stroke();

        // The order line: where this group has been told to go.
        const destination = group.order.destination;
        if (destination !== undefined) {
          context.setLineDash([12 / camera.zoom, 10 / camera.zoom]);
          context.beginPath();
          context.moveTo(x, y);
          context.lineTo(destination.x, destination.y);
          context.stroke();
          context.setLineDash([]);
        }
      }

      if (!isPlayer) continue;

      context.fillStyle = selected.has(group.id) ? PALETTE.selection : 'rgba(226, 238, 226, 0.72)';
      context.fillText(`${group.name}  ${group.members.length}`, x, labelY);

      // A short morale bar under the name, so a breaking flank is obvious.
      const barWidth = 84 / camera.zoom;
      const barHeight = 4 / camera.zoom;
      const barY = labelY + 4 / camera.zoom;
      context.fillStyle = 'rgba(0, 0, 0, 0.45)';
      context.fillRect(x - barWidth / 2, barY, barWidth, barHeight);
      context.fillStyle = moraleColor(group.morale);
      context.fillRect(x - barWidth / 2, barY, (barWidth * group.morale) / 100, barHeight);
    }
  }
}
