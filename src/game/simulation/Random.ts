export interface RandomState {
  value: number;
}

export class SeededRandom {
  public constructor(private readonly state: RandomState) {}

  public next(): number {
    let value = this.state.value | 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state.value = value >>> 0;
    return this.state.value / 0x1_0000_0000;
  }

  public nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError('maxExclusive must be a positive integer.');
    }
    return Math.floor(this.next() * maxExclusive);
  }
}
