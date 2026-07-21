import { describe, it, expect } from 'vitest';
import { calculateHeatIndex, getSecureRandom } from './saunaUtils';

describe('saunaUtils', () => {
  describe('calculateHeatIndex', () => {
    it('calculates heat index correctly', () => {
      expect(calculateHeatIndex(90, 50)).toBe(90 + 50 * 0.45);
    });
  });

  describe('getSecureRandom', () => {
    it('returns a number between 0 and 1', () => {
      for (let i = 0; i < 100; i++) {
        const val = getSecureRandom();
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
  });
});
