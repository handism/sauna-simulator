// Idle frame rate: a still view draws at most 30 frames a second, a moving one (looking around, a
// stage's view, the löyly's steam) every frame the display gives. The scene is watched more than
// turned, and every frame draws it whole (the water, the steam and the time of day move on), so a
// still view at the display's rate keeps the GPU busy for little: on a fanless laptop, warm.
//
// A frame is drawn once IDLE_MS less SLACK_MS has passed since the last, so the display's frames
// are skipped evenly: every other at 60 Hz, three in four at 120 Hz.

export const IDLE_MS = 1000 / 30;
/** Under a frame at 120 Hz, so a late frame at 60 Hz still draws on the second. */
export const SLACK_MS = 6;
/** How long a moving view keeps the full rate after it stops (the history of temporalAA.ts settles meanwhile). */
export const HOLD_MS = 1000;

export function createFrameRate() {
  let lastDrawn = -Infinity;
  let fullUntil = -Infinity;
  return {
    /** Draws every frame until `now + duration`. */
    hold(now: number, duration = HOLD_MS) {
      fullUntil = Math.max(fullUntil, now + duration);
    },
    /** Whether the frame at `now` is at the full rate (the moving view's). */
    full(now: number) {
      return now < fullUntil;
    },
    /** Whether to draw the frame at `now`; a drawn frame counts from `now`. */
    draw(now: number) {
      if (!this.full(now) && now - lastDrawn < IDLE_MS - SLACK_MS) return false;
      lastDrawn = now;
      return true;
    },
  };
}
