import { UNIT_CAPACITY, UNIT_STATS } from '../config/battle';
import { categoryAt, categoryIndex, type UnitCategory } from '../types/domain';

/**
 * Struct-of-arrays storage for every soldier on the field.
 *
 * Individual units have no string identity and never cross the WebMCP boundary.
 * They are addressed by slot index; groups are the only addressable entity for
 * the player and the Marshal. Dead slots are recycled through a free list so a
 * long battle allocates nothing after startup.
 */
export class UnitPool {
  public readonly capacity: number;

  /** High-water mark of slots ever used. Iterate `0 .. count` and test `alive`. */
  public count = 0;

  public readonly owner: Uint8Array;
  public readonly group: Int32Array;
  public readonly category: Uint8Array;
  public readonly x: Float32Array;
  public readonly y: Float32Array;
  /** Persistent velocity gives charges momentum and makes steering physical. */
  public readonly velocityX: Float32Array;
  public readonly velocityY: Float32Array;
  /** Assigned formation slot in world space. */
  public readonly slotX: Float32Array;
  public readonly slotY: Float32Array;
  public readonly hp: Float32Array;
  public readonly cooldown: Float32Array;
  /** Index of the current target, or -1. */
  public readonly targetIdx: Int32Array;
  public readonly alive: Uint8Array;

  /** Recycled slots, consumed from the end for deterministic reuse order. */
  private readonly freeSlots: number[] = [];

  public constructor(capacity: number = UNIT_CAPACITY) {
    this.capacity = capacity;
    this.owner = new Uint8Array(capacity);
    this.group = new Int32Array(capacity).fill(-1);
    this.category = new Uint8Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.velocityX = new Float32Array(capacity);
    this.velocityY = new Float32Array(capacity);
    this.slotX = new Float32Array(capacity);
    this.slotY = new Float32Array(capacity);
    this.hp = new Float32Array(capacity);
    this.cooldown = new Float32Array(capacity);
    this.targetIdx = new Int32Array(capacity).fill(-1);
    this.alive = new Uint8Array(capacity);
  }

  /** Returns the new slot index, or -1 when the pool is exhausted. */
  public spawn(
    owner: number,
    groupSlot: number,
    category: UnitCategory,
    x: number,
    y: number,
  ): number {
    const index = this.freeSlots.pop() ?? (this.count < this.capacity ? this.count++ : -1);
    if (index < 0) return -1;

    this.owner[index] = owner;
    this.group[index] = groupSlot;
    this.category[index] = categoryIndex(category);
    this.x[index] = x;
    this.y[index] = y;
    this.velocityX[index] = 0;
    this.velocityY[index] = 0;
    this.slotX[index] = x;
    this.slotY[index] = y;
    this.hp[index] = UNIT_STATS[category].maxHitPoints;
    this.cooldown[index] = 0;
    this.targetIdx[index] = -1;
    this.velocityX[index] = 0;
    this.velocityY[index] = 0;
    this.alive[index] = 1;
    return index;
  }

  public kill(index: number): void {
    if (this.alive[index] !== 1) return;
    this.alive[index] = 0;
    this.hp[index] = 0;
    this.group[index] = -1;
    this.targetIdx[index] = -1;
    this.freeSlots.push(index);
  }

  public isAlive(index: number): boolean {
    return index >= 0 && index < this.count && this.alive[index] === 1;
  }

  public categoryOf(index: number): UnitCategory {
    return categoryAt(this.category[index] ?? 0);
  }

  public livingCount(): number {
    let total = 0;
    for (let index = 0; index < this.count; index += 1) {
      if (this.alive[index] === 1) total += 1;
    }
    return total;
  }

  /**
   * Order-independent checksum of all mutable unit state. Used by the
   * determinism tests; positions are quantised so float noise cannot mask a
   * genuine divergence behind an insignificant last-bit difference.
   */
  public checksum(): number {
    let hash = 2_166_136_261;
    const mix = (value: number): void => {
      hash ^= value | 0;
      hash = Math.imul(hash, 16_777_619) >>> 0;
    };
    for (let index = 0; index < this.count; index += 1) {
      if (this.alive[index] !== 1) continue;
      mix(index);
      mix(this.owner[index] ?? 0);
      mix(this.group[index] ?? -1);
      mix(this.category[index] ?? 0);
      mix(Math.round((this.x[index] ?? 0) * 16));
      mix(Math.round((this.y[index] ?? 0) * 16));
      mix(Math.round((this.velocityX[index] ?? 0) * 64));
      mix(Math.round((this.velocityY[index] ?? 0) * 64));
      mix(Math.round((this.hp[index] ?? 0) * 16));
      mix(Math.round(this.cooldown[index] ?? 0));
    }
    return hash >>> 0;
  }
}

/**
 * Read-only projection of the pool handed to the renderer. The renderer must
 * never write through these references; the alias exists to make that a type
 * error rather than a convention.
 */
export interface UnitPoolView {
  readonly count: number;
  readonly owner: Readonly<Uint8Array>;
  readonly group: Readonly<Int32Array>;
  readonly category: Readonly<Uint8Array>;
  readonly x: Readonly<Float32Array>;
  readonly y: Readonly<Float32Array>;
  readonly hp: Readonly<Float32Array>;
  readonly alive: Readonly<Uint8Array>;
}
