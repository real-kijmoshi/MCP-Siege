import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../src/game/simulation/Random';

describe('seeded random', () => {
  it('repeats a sequence for the same initial state', () => {
    const first = new SeededRandom({ value: 99 });
    const second = new SeededRandom({ value: 99 });
    expect(Array.from({ length: 20 }, () => first.next())).toEqual(
      Array.from({ length: 20 }, () => second.next()),
    );
  });
});
