import { describe, it, expect } from 'vitest';
import { calculateHeatIndex, calculateTotonouScore, getSecureRandom } from './saunaUtils';

describe('saunaUtils', () => {
  describe('calculateHeatIndex', () => {
    it('should calculate heat index correctly with typical sauna values', () => {
      expect(calculateHeatIndex(100, 50)).toBe(122.5);
      expect(calculateHeatIndex(80, 20)).toBe(89);
      expect(calculateHeatIndex(90, 30)).toBe(103.5);
    });

    it('should handle zero values', () => {
      expect(calculateHeatIndex(0, 0)).toBe(0);
      expect(calculateHeatIndex(100, 0)).toBe(100);
      expect(calculateHeatIndex(0, 50)).toBe(22.5);
    });

    it('should handle extreme values', () => {
      expect(calculateHeatIndex(120, 100)).toBe(165);
      expect(calculateHeatIndex(-10, 50)).toBe(12.5);
    });

    it('should handle negative values correctly', () => {
      expect(calculateHeatIndex(-50, -50)).toBe(-72.5);
    });
  });

  describe('calculateTotonouScore', () => {
    it('should return maximum score (100) and top feedback when conditions are fully satisfied', () => {
      const result = calculateTotonouScore(60, 25, 2);
      expect(result.maxTotonou).toBe(100);
      expect(result.feedback).toContain('完璧な温冷交代浴です！');
    });

    it('should return high feedback when score is >= 70', () => {
      const result = calculateTotonouScore(45, 18, 1);
      expect(result.maxTotonou).toBeGreaterThanOrEqual(70);
      expect(result.maxTotonou).toBeLessThan(90);
      expect(result.feedback).toContain('しっかり「ととのい」の波が押し寄せています');
    });

    it('should advise more sauna time when saunaTime < 15', () => {
      const result = calculateTotonouScore(10, 20, 0);
      expect(result.feedback).toContain('サウナ室の温まりが少し足りなかったようです');
    });

    it('should advise more water time when waterTime < 8 and saunaTime >= 15', () => {
      const result = calculateTotonouScore(30, 5, 0);
      expect(result.feedback).toContain('水風呂の冷却が短かったようです');
    });

    it('should provide standard rest feedback for intermediate durations', () => {
      const result = calculateTotonouScore(20, 10, 0);
      expect(result.feedback).toContain('心地よい休息です');
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

    it('falls back to Math.random if crypto is undefined', () => {
      const originalCrypto = globalThis.crypto;
      // @ts-ignore
      delete globalThis.crypto;

      const val = getSecureRandom();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);

      // Restore
      globalThis.crypto = originalCrypto;
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
