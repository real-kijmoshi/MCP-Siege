import type { GameCommand } from './types';

export class CommandQueue {
  private pending: GameCommand[] = [];

  public enqueue(command: GameCommand): void {
    this.pending.push(command);
  }

  public drainReady(currentTick: number): GameCommand[] {
    const ready: GameCommand[] = [];
    const waiting: GameCommand[] = [];

    for (const command of this.pending) {
      (command.issuedAtTick <= currentTick ? ready : waiting).push(command);
    }

    this.pending = waiting;
    return ready.sort(
      (left, right) =>
        left.issuedAtTick - right.issuedAtTick || left.sequence - right.sequence,
    );
  }

  public get size(): number {
    return this.pending.length;
  }
}
