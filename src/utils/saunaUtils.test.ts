import { describe, it, expect } from 'vitest';
import { beatSeconds, calculateHeatIndex, calculateTotonouScore } from './saunaUtils';

describe('saunaUtils', () => {
  it('beatSeconds converts BPM to seconds per beat', () => {
    expect(beatSeconds(60)).toBe(1);
    expect(beatSeconds(120)).toBe(0.5);
  });

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
      expect(result.feedback).toContain('深い余韻を、そのままゆっくり味わって。');
    });

    it('should return high feedback when score is >= 70', () => {
      const result = calculateTotonouScore(45, 18, 1);
      expect(result.maxTotonou).toBeGreaterThanOrEqual(70);
      expect(result.maxTotonou).toBeLessThan(90);
      expect(result.feedback).toContain('心地よい余韻が広がっています。');
    });

    it('should offer gentle feedback when saunaTime < 15', () => {
      const result = calculateTotonouScore(10, 20, 0);
      expect(result.feedback).toContain('短いひと息も、大切な休息です。');
    });

    it('should offer unhurried feedback when waterTime < 8 and saunaTime >= 15', () => {
      const result = calculateTotonouScore(30, 5, 0);
      expect(result.feedback).toContain('自分のペースで、風に身を任せて。');
    });

    it('should provide standard rest feedback for intermediate durations', () => {
      const result = calculateTotonouScore(20, 10, 0);
      expect(result.feedback).toContain('心地よい休息です');
    });
  });
});
