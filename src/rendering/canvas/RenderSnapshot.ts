import type { GameState } from '../../game/simulation/GameState';

/**
 * Positions from immediately before the latest simulation step.
 *
 * The simulation deliberately runs at 20 Hz. Keeping one compact, render-only
 * snapshot lets the canvas interpolate those authoritative positions at the
 * display refresh rate without changing simulation timing or determinism.
 */
export class RenderSnapshot {
  public readonly unitX: Float32Array;
  public readonly unitY: Float32Array;
  public readonly unitAlive: Uint8Array;
  public groupX = new Float32Array(64);
  public groupY = new Float32Array(64);

  public constructor(unitCapacity: number) {
    this.unitX = new Float32Array(unitCapacity);
    this.unitY = new Float32Array(unitCapacity);
    this.unitAlive = new Uint8Array(unitCapacity);
  }

  public capture(state: GameState): void {
    const units = state.units;
    for (let index = 0; index < units.count; index += 1) {
      this.unitX[index] = units.x[index] ?? 0;
      this.unitY[index] = units.y[index] ?? 0;
      this.unitAlive[index] = units.alive[index] ?? 0;
    }

    this.ensureGroupCapacity(state.groups.length);
    for (let slot = 0; slot < state.groups.length; slot += 1) {
      const group = state.groups[slot];
      if (group === undefined) continue;
      this.groupX[slot] = group.anchor.x;
      this.groupY[slot] = group.anchor.y;
    }
  }

  private ensureGroupCapacity(size: number): void {
    if (this.groupX.length >= size) return;
    let capacity = this.groupX.length;
    while (capacity < size) capacity *= 2;
    const nextX = new Float32Array(capacity);
    const nextY = new Float32Array(capacity);
    nextX.set(this.groupX);
    nextY.set(this.groupY);
    this.groupX = nextX;
    this.groupY = nextY;
  }
}
