import { describe, expect, it } from 'vitest';
import { createFrameMetrics } from './frameMetrics';

describe('frame metrics', () => {
  it('records the mean and longest of the first 180 intervals once', () => {
    const element = document.createElement('div');
    const metrics = createFrameMetrics(element);
    expect(metrics.frame(1000)).toBe(0);
    for (let i = 1; i <= 180; i++) metrics.frame(1000 + i * 10 + (i === 90 ? 40 : 0) - (i === 91 ? 40 : 0));
    expect(element.dataset.frameMeanMs).toBe('10.00');
    expect(element.dataset.frameMaxMs).toBe('50.00');
    metrics.frame(5000);
    expect(element.dataset.frameMaxMs).toBe('50.00');
  });

  it('returns seconds since the last frame, capped at 0.1, and skips the gap after a pause', () => {
    const metrics = createFrameMetrics(document.createElement('div'));
    metrics.frame(100);
    expect(metrics.frame(116)).toBeCloseTo(0.016);
    expect(metrics.frame(1116)).toBe(0.1);
    metrics.pause();
    expect(metrics.frame(9000)).toBe(0);
  });

  it('starts over on reset', () => {
    const element = document.createElement('div');
    const metrics = createFrameMetrics(element);
    for (let i = 0; i <= 180; i++) metrics.frame(100 + i * 16);
    expect(element.dataset.frameMeanMs).toBe('16.00');
    metrics.reset();
    expect(element.dataset.frameMeanMs).toBeUndefined();
    expect(element.dataset.frameMaxMs).toBeUndefined();
    for (let i = 0; i <= 180; i++) metrics.frame(10_000 + i * 20);
    expect(element.dataset.frameMeanMs).toBe('20.00');
  });
});
