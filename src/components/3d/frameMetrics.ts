const SAMPLES = 180;

/**
 * Frame intervals for browser tests: the mean and the longest of the first 180 after a reset, as
 * data-frame-mean-ms and data-frame-max-ms on `element`.
 */
export function createFrameMetrics(element: HTMLElement) {
  let previous = 0;
  let recorded = false;
  const times: number[] = [];
  return {
    /** Starts over, as after a change of quality, resolution, view or scenery. */
    reset() {
      previous = 0;
      recorded = false;
      times.length = 0;
      delete element.dataset.frameMeanMs;
      delete element.dataset.frameMaxMs;
    },
    /** The next frame does not count the time since this one (a hidden page draws none). */
    pause() {
      previous = 0;
    },
    /** Records a frame at `now` (milliseconds); returns the seconds since the last, at most 0.1. */
    frame(now: number) {
      const delta = previous ? Math.min((now - previous) / 1000, 0.1) : 0;
      if (previous && times.length < SAMPLES) times.push(now - previous);
      previous = now;
      if (times.length === SAMPLES && !recorded) {
        recorded = true;
        element.dataset.frameMeanMs = (times.reduce((a, b) => a + b, 0) / SAMPLES).toFixed(2);
        element.dataset.frameMaxMs = Math.max(...times).toFixed(2);
      }
      return delta;
    },
  };
}
