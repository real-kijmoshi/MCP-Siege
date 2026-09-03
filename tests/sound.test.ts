import { describe, expect, it } from 'vitest';
import { CombatCueLimiter } from '../src/audio/SoundManager';

describe('combat sound limiter', () => {
  it('limits each combat voice independently', () => {
    const limiter = new CombatCueLimiter();
    expect(limiter.accept('melee', 1_000)).toBe(true);
    expect(limiter.accept('melee', 1_094)).toBe(false);
    expect(limiter.accept('arrow', 1_010)).toBe(true);
    expect(limiter.accept('siege', 1_020)).toBe(true);
    expect(limiter.accept('arrow', 1_159)).toBe(false);
    expect(limiter.accept('arrow', 1_160)).toBe(true);
  });

  it('resets after muting so the next visible blow is heard', () => {
    const limiter = new CombatCueLimiter();
    expect(limiter.accept('siege', 500)).toBe(true);
    expect(limiter.accept('siege', 600)).toBe(false);
    limiter.reset();
    expect(limiter.accept('siege', 600)).toBe(true);
  });

  it('rejects clocks that move backwards without corrupting the voice', () => {
    const limiter = new CombatCueLimiter();
    expect(limiter.accept('melee', 100)).toBe(true);
    expect(limiter.accept('melee', 90)).toBe(false);
    expect(limiter.accept('melee', 195)).toBe(true);
  });
});
