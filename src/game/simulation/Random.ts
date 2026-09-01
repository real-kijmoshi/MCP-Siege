export interface RandomState {
  value: number;
}

/** Allocation-free xorshift step for hot simulation loops. */
export function nextRandom(state: RandomState): number {
  let value = state.value | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.value = value >>> 0;
  return state.value / 0x1_0000_0000;
}

export class SeededRandom {
  public constructor(private readonly state: RandomState) {}

  public next(): number {
    return nextRandom(this.state);
  }

  public nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError('maxExclusive must be a positive integer.');
    }
    return Math.floor(this.next() * maxExclusive);
  }
}
