import { FIXED_STEP_MS } from '../config/battle';
import type { SimulationEngine } from './Engine';

export class FixedStepRunner {
  private accumulatorMs = 0;
  private previousTimeMs: number | undefined;
  private frameId: number | undefined;

  public constructor(private readonly engine: SimulationEngine) {}

  public start(): void {
    if (this.frameId !== undefined) return;
    this.frameId = requestAnimationFrame(this.frame);
  }

  public stop(): void {
    if (this.frameId !== undefined) cancelAnimationFrame(this.frameId);
    this.frameId = undefined;
    this.previousTimeMs = undefined;
    this.accumulatorMs = 0;
  }

  private readonly frame = (timeMs: number): void => {
    if (this.previousTimeMs === undefined) this.previousTimeMs = timeMs;
    const elapsedMs = Math.min(timeMs - this.previousTimeMs, 250);
    this.previousTimeMs = timeMs;
    this.accumulatorMs += elapsedMs;

    while (this.accumulatorMs >= FIXED_STEP_MS) {
      this.engine.step();
      this.accumulatorMs -= FIXED_STEP_MS;
    }

    this.frameId = requestAnimationFrame(this.frame);
  };
}
