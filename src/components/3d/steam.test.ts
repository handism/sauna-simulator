import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSteam, updateSteamPositions } from './steam';

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

describe('löyly steam puff', () => {
  // jsdom has no 2D canvas.
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      createRadialGradient: () => ({ addColorStop() {} }),
      fillRect() {},
    } as any);
    return () => vi.restoreAllMocks();
  });

  it('stays visible until first updated, so the scene compile includes it', () => {
    expect(createSteam().points.visible).toBe(true);
  });

  it('shows a six-second puff from each start, only while active', () => {
    const steam = createSteam();
    const material = steam.points.material as import('three').PointsMaterial;
    steam.update(0, true, false);
    expect(steam.points.visible).toBe(false);
    steam.start(1000);
    steam.update(4000, true, false);
    expect(steam.points.visible).toBe(true);
    expect(material.opacity).toBeCloseTo(0.24);
    steam.update(4000, false, false);
    expect(steam.points.visible).toBe(false);
    steam.update(7001, true, false);
    expect(steam.points.visible).toBe(false);
  });

  it('ends the puff on stop', () => {
    const steam = createSteam();
    steam.start(0);
    steam.stop();
    expect(steam.points.visible).toBe(false);
    steam.update(1000, true, false);
    expect(steam.points.visible).toBe(false);
  });
});
