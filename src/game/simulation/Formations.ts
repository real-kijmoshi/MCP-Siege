import { FORMATION_PROFILES } from '../config/battle';
import type { Formation, Vector2D } from '../types/domain';

/**
 * Formation slot geometry.
 *
 * Slots are generated in a local frame where +x runs along the front line and
 * +y runs backwards into the formation's depth, then rotated onto the group's
 * facing. The generator is pure and allocation-free at the call site: callers
 * pass the output buffers in.
 */

/**
 * Stable per-index jitter for the loose formation. A hash rather than the
 * seeded PRNG, so scattering never consumes simulation randomness and stays
 * identical across replays.
 */
function jitter(index: number, salt: number): number {
  let value = Math.imul(index + salt * 0x9e37, 0x85eb_ca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2_ae35);
  value ^= value >>> 16;
  // Map to [-0.5, 0.5].
  return ((value >>> 0) / 0xffff_ffff) - 0.5;
}

/** Local-space offset of one slot, before rotation. */
function localSlot(
  formation: Formation,
  index: number,
  count: number,
  out: Vector2D,
): void {
  const profile = FORMATION_PROFILES[formation];
  const spacing = profile.spacing;

  if (formation === 'wedge') {
    // Row r holds r+1 men. Find the row containing this index.
    const row = Math.floor((Math.sqrt(8 * index + 1) - 1) / 2);
    const rowStart = (row * (row + 1)) / 2;
    const column = index - rowStart;
    out.x = (column - row / 2) * spacing;
    out.y = row * spacing * 0.85;
    return;
  }

  if (formation === 'square') {
    // Hollow rings, outermost first, so the interior stays empty.
    const side = Math.max(3, Math.ceil(Math.sqrt(count * 1.75)));
    let remaining = index;
    let ring = 0;
    for (;;) {
      const ringSide = side - ring * 2;
      if (ringSide <= 1) {
        // Degenerate centre: stack anything left over at the middle.
        out.x = 0;
        out.y = 0;
        return;
      }
      const perimeter = ringSide * 4 - 4;
      if (remaining < perimeter) {
        const half = (side - 1) / 2;
        const min = ring;
        const max = side - 1 - ring;
        let cellX: number;
        let cellY: number;
        if (remaining < ringSide) {
          cellX = min + remaining;
          cellY = min;
        } else if (remaining < ringSide * 2 - 1) {
          cellX = max;
          cellY = min + (remaining - ringSide + 1);
        } else if (remaining < ringSide * 3 - 2) {
          cellX = max - (remaining - (ringSide * 2 - 1)) - 1;
          cellY = max;
        } else {
          cellX = min;
          cellY = max - (remaining - (ringSide * 3 - 2)) - 1;
        }
        out.x = (cellX - half) * spacing;
        out.y = (cellY - half) * spacing + half * spacing;
        return;
      }
      remaining -= perimeter;
      ring += 1;
    }
  }

  // line, column, block, double_line and loose are all grids of differing width.
  const width = Math.max(1, Math.round(Math.sqrt(Math.max(count, 1)) * profile.frontage));
  const column = index % width;
  const row = Math.floor(index / width);
  let x = (column - (width - 1) / 2) * spacing;
  let y = row * spacing;

  if (formation === 'loose') {
    x += jitter(index, 1) * spacing * 0.7;
    y += jitter(index, 2) * spacing * 0.7;
  }

  out.x = x;
  out.y = y;
}

const scratch: Vector2D = { x: 0, y: 0 };

/**
 * Writes world-space slot positions for `count` units into `outX` / `outY`.
 *
 * `facing` is the direction the formation looks in, in radians. Depth extends
 * away from that direction so the front rank is nearest the enemy.
 */
export function fillFormationSlots(
  formation: Formation,
  count: number,
  anchor: Vector2D,
  facing: number,
  outX: Float32Array,
  outY: Float32Array,
  offset = 0,
): void {
  const forwardX = Math.cos(facing);
  const forwardY = Math.sin(facing);
  // Right-hand perpendicular of the facing direction.
  const rightX = -forwardY;
  const rightY = forwardX;

  for (let index = 0; index < count; index += 1) {
    localSlot(formation, index, count, scratch);
    outX[offset + index] = anchor.x + rightX * scratch.x - forwardX * scratch.y;
    outY[offset + index] = anchor.y + rightY * scratch.x - forwardY * scratch.y;
  }
}

/** Convenience form used by tests and the plan preview. */
export function formationSlots(
  formation: Formation,
  count: number,
  anchor: Vector2D,
  facing: number,
): Vector2D[] {
  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  fillFormationSlots(formation, count, anchor, facing, xs, ys);
  const slots: Vector2D[] = new Array<Vector2D>(count);
  for (let index = 0; index < count; index += 1) {
    slots[index] = { x: xs[index] ?? 0, y: ys[index] ?? 0 };
  }
  return slots;
}

/** Approximate radius a formation of this size occupies, for hit-testing. */
export function formationRadius(formation: Formation, count: number): number {
  const profile = FORMATION_PROFILES[formation];
  const width = Math.max(1, Math.round(Math.sqrt(Math.max(count, 1)) * profile.frontage));
  const rows = Math.ceil(Math.max(count, 1) / width);
  const halfWidth = (width * profile.spacing) / 2;
  const halfDepth = (rows * profile.spacing) / 2;
  return Math.max(halfWidth, halfDepth, profile.spacing);
}
