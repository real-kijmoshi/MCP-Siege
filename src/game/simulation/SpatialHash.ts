import { MAP_HEIGHT, MAP_WIDTH, SPATIAL_CELL_SIZE } from '../config/battle';
import type { UnitPool } from './UnitPool';

/**
 * Uniform-grid broad phase for target acquisition.
 *
 * Rebuilt every tick by counting sort into preallocated typed arrays, so a
 * full rebuild across thousands of units allocates nothing. One hash is kept
 * per faction, which halves the work of an enemy search.
 */
export class SpatialHash {
  private readonly columns: number;
  private readonly rows: number;
  private readonly cellCount: number;

  private readonly counts: Int32Array;
  private readonly starts: Int32Array;
  private readonly cursor: Int32Array;
  private readonly items: Int32Array;

  public constructor(capacity: number) {
    this.columns = Math.ceil(MAP_WIDTH / SPATIAL_CELL_SIZE) + 1;
    this.rows = Math.ceil(MAP_HEIGHT / SPATIAL_CELL_SIZE) + 1;
    this.cellCount = this.columns * this.rows;
    this.counts = new Int32Array(this.cellCount);
    this.starts = new Int32Array(this.cellCount + 1);
    this.cursor = new Int32Array(this.cellCount);
    this.items = new Int32Array(capacity);
  }

  private cellOf(x: number, y: number): number {
    const column = Math.min(
      this.columns - 1,
      Math.max(0, Math.floor(x / SPATIAL_CELL_SIZE)),
    );
    const row = Math.min(this.rows - 1, Math.max(0, Math.floor(y / SPATIAL_CELL_SIZE)));
    return row * this.columns + column;
  }

  /** Indexes every living unit belonging to `faction`. */
  public build(pool: UnitPool, faction: number): void {
    this.counts.fill(0);

    for (let index = 0; index < pool.count; index += 1) {
      if (pool.alive[index] !== 1 || pool.owner[index] !== faction) continue;
      const cell = this.cellOf(pool.x[index] ?? 0, pool.y[index] ?? 0);
      this.counts[cell] = (this.counts[cell] ?? 0) + 1;
    }

    let running = 0;
    for (let cell = 0; cell < this.cellCount; cell += 1) {
      this.starts[cell] = running;
      this.cursor[cell] = running;
      running += this.counts[cell] ?? 0;
    }
    this.starts[this.cellCount] = running;

    for (let index = 0; index < pool.count; index += 1) {
      if (pool.alive[index] !== 1 || pool.owner[index] !== faction) continue;
      const cell = this.cellOf(pool.x[index] ?? 0, pool.y[index] ?? 0);
      const slot = this.cursor[cell] ?? 0;
      this.items[slot] = index;
      this.cursor[cell] = slot + 1;
    }
  }

  /**
   * Nearest indexed unit to the point within `radius`, or -1.
   * Scanning the cell block directly avoids allocating a candidate list.
   */
  public findNearest(x: number, y: number, radius: number, pool: UnitPool): number {
    const minColumn = Math.max(0, Math.floor((x - radius) / SPATIAL_CELL_SIZE));
    const maxColumn = Math.min(this.columns - 1, Math.floor((x + radius) / SPATIAL_CELL_SIZE));
    const minRow = Math.max(0, Math.floor((y - radius) / SPATIAL_CELL_SIZE));
    const maxRow = Math.min(this.rows - 1, Math.floor((y + radius) / SPATIAL_CELL_SIZE));

    let best = -1;
    let bestDistance = radius * radius;

    for (let row = minRow; row <= maxRow; row += 1) {
      const rowOffset = row * this.columns;
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const cell = rowOffset + column;
        const end = this.starts[cell + 1] ?? 0;
        for (let slot = this.starts[cell] ?? 0; slot < end; slot += 1) {
          const candidate = this.items[slot] ?? -1;
          if (candidate < 0 || pool.alive[candidate] !== 1) continue;
          const dx = (pool.x[candidate] ?? 0) - x;
          const dy = (pool.y[candidate] ?? 0) - y;
          const distance = dx * dx + dy * dy;
          // Index order breaks ties so the result never depends on cell layout.
          if (distance < bestDistance || (distance === bestDistance && candidate < best)) {
            bestDistance = distance;
            best = candidate;
          }
        }
      }
    }
    return best;
  }

  /** Invokes `visit` for every indexed unit within `radius` of the point. */
  public forEachNear(
    x: number,
    y: number,
    radius: number,
    pool: UnitPool,
    visit: (index: number) => void,
  ): void {
    const minColumn = Math.max(0, Math.floor((x - radius) / SPATIAL_CELL_SIZE));
    const maxColumn = Math.min(this.columns - 1, Math.floor((x + radius) / SPATIAL_CELL_SIZE));
    const minRow = Math.max(0, Math.floor((y - radius) / SPATIAL_CELL_SIZE));
    const maxRow = Math.min(this.rows - 1, Math.floor((y + radius) / SPATIAL_CELL_SIZE));
    const radiusSquared = radius * radius;

    for (let row = minRow; row <= maxRow; row += 1) {
      const rowOffset = row * this.columns;
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const cell = rowOffset + column;
        const end = this.starts[cell + 1] ?? 0;
        for (let slot = this.starts[cell] ?? 0; slot < end; slot += 1) {
          const candidate = this.items[slot] ?? -1;
          if (candidate < 0 || pool.alive[candidate] !== 1) continue;
          const dx = (pool.x[candidate] ?? 0) - x;
          const dy = (pool.y[candidate] ?? 0) - y;
          if (dx * dx + dy * dy <= radiusSquared) visit(candidate);
        }
      }
    }
  }
}
