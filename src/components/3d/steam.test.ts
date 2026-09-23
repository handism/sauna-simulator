import { describe, expect, it } from 'vitest';
import { updateSteamPositions } from './steam';

describe('steam motion preference', () => {
  it('keeps every coordinate still throughout a reduced-motion puff', () => {
    const positions = new Float32Array(270);
    updateSteamPositions(positions, 0, true);
    const initial = positions.slice();
    for (const age of [0.5, 2, 4, 5.9]) {
      updateSteamPositions(positions, age, true);
      expect(positions).toEqual(initial);
    }
    expect(new Set(positions).size).toBeGreaterThan(90);
  });

  it('animates normally and honors a changed preference on the next update', () => {
    const positions = new Float32Array(270);
    updateSteamPositions(positions, 1, false);
    const initial = positions.slice();
    updateSteamPositions(positions, 2, false);
    expect(positions).not.toEqual(initial);
    updateSteamPositions(positions, 2, true);
    const still = positions.slice();
    updateSteamPositions(positions, 3, true);
    expect(positions).toEqual(still);
    updateSteamPositions(positions, 4, false);
    expect(positions).not.toEqual(still);
  });
});
