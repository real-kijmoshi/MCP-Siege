import {
  FIRE,
  MAP_HEIGHT,
  MAP_WIDTH,
  PHYSICS,
  SPATIAL_CELL_SIZE,
  UNIT_STATS,
} from '../config/battle';
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

  /**
   * How many indexed units stand within `radius` of a point, excluding `self`.
   *
   * Kept separate from `forEachNear` because the crowding sample runs for a
   * cohort of the whole army every tick, and a visitor callback there would
   * allocate a closure per soldier.
   */
  public countNear(
    x: number,
    y: number,
    radius: number,
    pool: UnitPool,
    self: number,
  ): number {
    const minColumn = Math.max(0, Math.floor((x - radius) / SPATIAL_CELL_SIZE));
    const maxColumn = Math.min(this.columns - 1, Math.floor((x + radius) / SPATIAL_CELL_SIZE));
    const minRow = Math.max(0, Math.floor((y - radius) / SPATIAL_CELL_SIZE));
    const maxRow = Math.min(this.rows - 1, Math.floor((y + radius) / SPATIAL_CELL_SIZE));
    const radiusSquared = radius * radius;

    let found = 0;
    for (let row = minRow; row <= maxRow; row += 1) {
      const rowOffset = row * this.columns;
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const cell = rowOffset + column;
        const end = this.starts[cell + 1] ?? 0;
        for (let slot = this.starts[cell] ?? 0; slot < end; slot += 1) {
          const candidate = this.items[slot] ?? -1;
          if (candidate < 0 || candidate === self || pool.alive[candidate] !== 1) continue;
          const dx = (pool.x[candidate] ?? 0) - x;
          const dy = (pool.y[candidate] ?? 0) - y;
          if (dx * dx + dy * dy <= radiusSquared) found += 1;
        }
      }
    }
    return found;
  }

  /**
   * Weighted count of indexed bodies standing in the lane between a shooter and
   * his target, ignoring everyone in `excludeGroup`.
   *
   * Called only on the tick a missile weapon is actually ready to loose, which
   * for a bow is once a second and for a gun once every seven and a half, so the
   * corridor trace costs a small fraction of what target acquisition already
   * does. Cells whose whole footprint lies clear of the lane are rejected before
   * any body in them is examined.
   *
   * A blocker at the muzzle counts for less than one standing among the men
   * being shot at: the first is an obstacle, the second is where a volley falls
   * short. Iteration follows the grid, so the sum is reproducible.
   */
  public weightedBlockersAlong(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    pool: UnitPool,
    excludeGroup: number,
  ): number {
    const spanX = x1 - x0;
    const spanY = y1 - y0;
    const length = Math.hypot(spanX, spanY);
    if (length <= FIRE.muzzleClearance) return 0;
    const unitX = spanX / length;
    const unitY = spanY / length;

    const halfWidth = FIRE.corridorHalfWidth;
    const minColumn = Math.max(
      0,
      Math.floor((Math.min(x0, x1) - halfWidth) / SPATIAL_CELL_SIZE),
    );
    const maxColumn = Math.min(
      this.columns - 1,
      Math.floor((Math.max(x0, x1) + halfWidth) / SPATIAL_CELL_SIZE),
    );
    const minRow = Math.max(0, Math.floor((Math.min(y0, y1) - halfWidth) / SPATIAL_CELL_SIZE));
    const maxRow = Math.min(
      this.rows - 1,
      Math.floor((Math.max(y0, y1) + halfWidth) / SPATIAL_CELL_SIZE),
    );

    // A cell whose centre is further from the lane than its own half-diagonal
    // plus the corridor cannot hold a blocker, and most cells in the bounding
    // box of a long shot are exactly that.
    const cellReach = halfWidth + SPATIAL_CELL_SIZE * 0.7072;
    const overrun = length + FIRE.targetClearance;

    let blockers = 0;
    for (let row = minRow; row <= maxRow; row += 1) {
      const rowOffset = row * this.columns;
      const cellY = (row + 0.5) * SPATIAL_CELL_SIZE;
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const cellX = (column + 0.5) * SPATIAL_CELL_SIZE;
        const centreOffset = Math.abs((cellX - x0) * -unitY + (cellY - y0) * unitX);
        if (centreOffset > cellReach) continue;

        const cell = rowOffset + column;
        const end = this.starts[cell + 1] ?? 0;
        for (let slot = this.starts[cell] ?? 0; slot < end; slot += 1) {
          const candidate = this.items[slot] ?? -1;
          if (candidate < 0 || pool.alive[candidate] !== 1) continue;
          // A regiment never masks itself. Its own ranks shoot as one body, and
          // what that costs is already priced by the formation's ranged profile.
          if (pool.group[candidate] === excludeGroup) continue;

          const dx = (pool.x[candidate] ?? 0) - x0;
          const dy = (pool.y[candidate] ?? 0) - y0;
          const along = dx * unitX + dy * unitY;
          if (along <= FIRE.muzzleClearance || along >= overrun) continue;
          if (Math.abs(dx * -unitY + dy * unitX) > halfWidth) continue;

          const share = along >= length ? 1 : along / length;
          blockers += FIRE.nearMuzzleWeight + (1 - FIRE.nearMuzzleWeight) * share;
        }
      }
    }
    return blockers;
  }

  /**
   * Adds a deterministic separation vector for bodies overlapping `self`.
   * The caller owns `out`, so local avoidance adds no per-unit allocations.
   */
  public accumulateSeparation(
    x: number,
    y: number,
    selfRadius: number,
    pool: UnitPool,
    self: number,
    out: Float32Array,
  ): void {
    const radius = selfRadius + PHYSICS.maximumBodyRadius;
    const minColumn = Math.max(0, Math.floor((x - radius) / SPATIAL_CELL_SIZE));
    const maxColumn = Math.min(this.columns - 1, Math.floor((x + radius) / SPATIAL_CELL_SIZE));
    const minRow = Math.max(0, Math.floor((y - radius) / SPATIAL_CELL_SIZE));
    const maxRow = Math.min(this.rows - 1, Math.floor((y + radius) / SPATIAL_CELL_SIZE));

    for (let row = minRow; row <= maxRow; row += 1) {
      const rowOffset = row * this.columns;
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const cell = rowOffset + column;
        const end = this.starts[cell + 1] ?? 0;
        for (let slot = this.starts[cell] ?? 0; slot < end; slot += 1) {
          const candidate = this.items[slot] ?? -1;
          if (candidate < 0 || candidate === self || pool.alive[candidate] !== 1) continue;
          // Formation slots already provide cohesion inside a regiment. Only
          // different bodies of troops need the expensive collision response.
          if (pool.group[candidate] === pool.group[self]) continue;
          let dx = x - (pool.x[candidate] ?? 0);
          let dy = y - (pool.y[candidate] ?? 0);
          let distanceSquared = dx * dx + dy * dy;
          const minimum = selfRadius + UNIT_STATS[pool.categoryOf(candidate)].bodyRadius;
          if (distanceSquared >= minimum * minimum) continue;

          if (distanceSquared < 0.0001) {
            // Stable index-derived direction when two bodies occupy one point.
            const angle = ((self * 37 + candidate * 17) % 360) * (Math.PI / 180);
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            distanceSquared = 1;
          }
          const distance = Math.sqrt(distanceSquared);
          const overlap = (minimum - distance) / minimum;
          out[0] = (out[0] ?? 0) + (dx / distance) * overlap;
          out[1] = (out[1] ?? 0) + (dy / distance) * overlap;
        }
      }
    }
  }
}
