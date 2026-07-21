import { describe, it, expect } from 'vitest';
import { calculateHeatIndex, getSecureRandom } from './saunaUtils';

describe('saunaUtils', () => {
  describe('calculateHeatIndex', () => {
    it('should calculate correct heat index for given temperature and humidity', () => {
      // 90°C, 10% humidity -> 90 + (10 * 0.45) = 94.5
      expect(calculateHeatIndex(90, 10)).toBe(94.5);
      // 80°C, 50% humidity -> 80 + (50 * 0.45) = 102.5
      expect(calculateHeatIndex(80, 50)).toBe(102.5);
    });
  });

  describe('getSecureRandom', () => {
    it('should return a number between 0 (inclusive) and 1 (exclusive)', () => {
      for (let i = 0; i < 100; i++) {
        const val = getSecureRandom();
        expect(typeof val).toBe('number');
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
      }
    });

    it('should return floating point numbers with reasonable randomness', () => {
      const results = new Set<number>();
      for (let i = 0; i < 50; i++) {
        results.add(getSecureRandom());
      }
      expect(results.size).toBeGreaterThan(45);
    });
  });
});
