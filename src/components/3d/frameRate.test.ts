import { describe, expect, it } from 'vitest';
import { createFrameRate, HOLD_MS } from './frameRate';

const drawn = (rate: ReturnType<typeof createFrameRate>, hz: number, frames: number, from = 0) => {
  let count = 0;
  for (let i = 0; i < frames; i++) if (rate.draw(from + (i * 1000) / hz)) count++;
  return count;
};

describe('frame rate', () => {
  it('draws a still view at 30 fps on 60 and 120 Hz displays', () => {
    expect(drawn(createFrameRate(), 60, 60)).toBe(30);
    expect(drawn(createFrameRate(), 120, 120)).toBe(30);
  });

  it('draws the frame after a late one at 60 Hz', () => {
    const rate = createFrameRate();
    expect(rate.draw(0)).toBe(true);
    expect(rate.draw(20)).toBe(false);
    expect(rate.draw(33.4)).toBe(true);
    expect(rate.draw(50)).toBe(false);
  });

  it('draws every frame while held, and back to 30 fps after', () => {
    const rate = createFrameRate();
    rate.hold(0);
    expect(rate.full(HOLD_MS - 1)).toBe(true);
    expect(drawn(rate, 60, 60)).toBe(60);
    expect(rate.full(HOLD_MS)).toBe(false);
    expect(drawn(rate, 60, 60, 1000)).toBe(30);
  });

  it('keeps the longest hold', () => {
    const rate = createFrameRate();
    rate.hold(0, 6000);
    rate.hold(100);
    expect(rate.full(5000)).toBe(true);
    expect(rate.full(6000)).toBe(false);
  });
});
