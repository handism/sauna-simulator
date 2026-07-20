import { describe, it, expect } from 'vitest';
import { calculateHeatIndex } from './saunaUtils';

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
