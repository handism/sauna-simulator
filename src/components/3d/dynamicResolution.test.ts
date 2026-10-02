import { describe, expect, it } from 'vitest';
import {
  createDynamicResolution,
  HITCH_MS,
  RAISE_AFTER_MAX_MS,
  RAISE_AFTER_MS,
  resolutionLevels,
  WINDOW_MS,
} from './dynamicResolution';

// Drives frames at a fixed interval for a while (or until the first change); returns every change
// with its time.
function run(
  controller: ReturnType<typeof createDynamicResolution>,
  start: number,
  interval: number,
  duration: number,
  untilChange = true,
) {
  const changes: [number, number][] = [];
  let now = start;
  for (; now < start + duration; now += interval) {
    const ratio = controller.frame(now);
    if (ratio === null) continue;
    changes.push([now, ratio]);
    if (untilChange) break;
  }
  return { changes, end: now };
}

// Slow frames until one step down; returns the next frame's time.
function stepDown(controller: ReturnType<typeof createDynamicResolution>, start: number) {
  for (let now = start; ; now += 1000 / 40) if (controller.frame(now) !== null) return now + 1000 / 60;
}

describe('resolutionLevels', () => {
  it('steps down by a quarter to 60% of the quality, never below 1', () => {
    expect(resolutionLevels(1.5)).toEqual([1.5, 1.25, 1]);
    expect(resolutionLevels(2)).toEqual([2, 1.75, 1.5, 1.25]);
    expect(resolutionLevels(1)).toEqual([1]);
    // A display ratio between the steps.
    expect(resolutionLevels(1.3)).toEqual([1.3, 1.05]);
  });
});

describe('createDynamicResolution', () => {
  it('keeps the ratio while frames hold 60 fps', () => {
    const controller = createDynamicResolution(1.5);
    expect(run(controller, 0, 1000 / 60, 60_000, false).changes).toEqual([]);
    expect(controller.pixelRatio).toBe(1.5);
  });

  it('does nothing with a single level', () => {
    const controller = createDynamicResolution(1);
    expect(run(controller, 0, 33.4, 20_000, false).changes).toEqual([]);
  });

  it('steps down while frames miss the budget, skipping the window after each switch', () => {
    const controller = createDynamicResolution(1.5);
    const { changes } = run(controller, 0, 1000 / 40, 10_000, false);
    expect(changes.map(([, ratio]) => ratio)).toEqual([1.25, 1]);
    // One window, then a discarded window and one more.
    expect(changes[0][0]).toBeGreaterThanOrEqual(WINDOW_MS);
    expect(changes[1][0] - changes[0][0]).toBeGreaterThanOrEqual(2 * WINDOW_MS);
    expect(controller.pixelRatio).toBe(1);
  });

  it('does not count hitches: a long frame restarts the window', () => {
    const controller = createDynamicResolution(1.5);
    let changes = 0;
    for (let now = 0; now < 30_000; now += 600) if (controller.frame(now) !== null) changes++;
    expect(HITCH_MS).toBeLessThan(600);
    expect(changes).toBe(0);
  });

  it('tries a step up after a run within the budget and backs off when it turns slow', () => {
    const controller = createDynamicResolution(1.5);
    let t = stepDown(controller, 0);
    expect(controller.pixelRatio).toBe(1.25);
    // Fast enough at 1.25: up after RAISE_AFTER_MS.
    let next = run(controller, t, 1000 / 60, RAISE_AFTER_MS + 3 * WINDOW_MS);
    expect(next.changes.map(([, ratio]) => ratio)).toEqual([1.5]);
    const firstWait = next.changes[0][0] - t;
    expect(firstWait).toBeGreaterThanOrEqual(RAISE_AFTER_MS);
    expect(firstWait).toBeLessThan(RAISE_AFTER_MS + 3 * WINDOW_MS);
    // Slow again at 1.5 at once: down, and the next trial waits twice as long.
    t = stepDown(controller, next.changes[0][0] + 1000 / 60);
    expect(controller.pixelRatio).toBe(1.25);
    next = run(controller, t, 1000 / 60, 2 * RAISE_AFTER_MS + 4 * WINDOW_MS);
    expect(next.changes.map(([, ratio]) => ratio)).toEqual([1.5]);
    expect(next.changes[0][0] - t).toBeGreaterThanOrEqual(2 * RAISE_AFTER_MS);
  });

  it('caps the back-off', () => {
    const controller = createDynamicResolution(1.5);
    let t = stepDown(controller, 0);
    let wait = 0;
    for (let trial = 0; trial < 8; trial++) {
      const up = run(controller, t, 1000 / 60, RAISE_AFTER_MAX_MS + 4 * WINDOW_MS);
      expect(up.changes).toHaveLength(1);
      wait = up.changes[0][0] - t;
      t = stepDown(controller, up.changes[0][0] + 1000 / 60);
      expect(controller.pixelRatio).toBe(1.25);
    }
    expect(wait).toBeLessThanOrEqual(RAISE_AFTER_MAX_MS + 3 * WINDOW_MS);
    expect(wait).toBeGreaterThanOrEqual(RAISE_AFTER_MAX_MS);
  });

  it('a step up that holds keeps its level', () => {
    const controller = createDynamicResolution(1.5);
    const t = stepDown(controller, 0);
    const { changes } = run(controller, t, 1000 / 60, 120_000, false);
    expect(changes.map(([, ratio]) => ratio)).toEqual([1.5]);
  });

  it('returns to the largest ratio on reset and waits the first trial again after settle', () => {
    const controller = createDynamicResolution(1.5);
    let t = stepDown(controller, 0);
    controller.reset(2);
    expect(controller.pixelRatio).toBe(2);
    t = stepDown(controller, t);
    expect(controller.pixelRatio).toBe(1.75);
    // A failed trial doubles the wait; settle clears it.
    const up = run(controller, t, 1000 / 60, RAISE_AFTER_MS + 3 * WINDOW_MS);
    t = stepDown(controller, up.changes[0][0] + 1000 / 60);
    controller.settle();
    const again = run(controller, t, 1000 / 60, RAISE_AFTER_MS + 3 * WINDOW_MS);
    expect(again.changes.map(([, ratio]) => ratio)).toEqual([2]);
  });
});
