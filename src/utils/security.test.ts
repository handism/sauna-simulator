import { describe, it, expect } from 'vitest';
import { secureRandom } from './security';

describe('secureRandom', () => {
  it('returns a number between 0 (inclusive) and 1 (exclusive)', () => {
    for (let i = 0; i < 100; i++) {
      const val = secureRandom();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('generates different values on subsequent calls', () => {
    const results = new Set(Array.from({ length: 50 }, () => secureRandom()));
    expect(results.size).toBeGreaterThan(1);
  });
});
