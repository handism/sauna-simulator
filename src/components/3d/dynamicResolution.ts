// Dynamic resolution: the pixel ratio steps down from the quality's while frames miss 60 fps and
// tries the next step up after a run of frames within it. Per pixel shading is nearly all of a
// frame (docs/3d-qa/depth-prepass), so the cost follows the pixel count.
//
// The display caps frames at its own interval, so frames within the budget cannot tell how much
// room is left: a step up is a trial, and one that turns slow at once doubles the wait before the
// next (backing off instead of switching back and forth; each switch reallocates the targets).

/** 60 fps, whatever the display's rate. */
export const BUDGET_MS = 1000 / 60;
/** Mean frame interval of a window above which the ratio steps down. */
export const SLOW_MS = BUDGET_MS * 1.1;
/** Mean frame interval of a window within which it counts toward a step up. */
export const GOOD_MS = BUDGET_MS * 1.04;
export const WINDOW_MS = 1000;
/** A longer interval (a hidden tab, a shader compile, a load) restarts the window uncounted. */
export const HITCH_MS = 250;
export const STEP = 0.25;
/** The lowest ratio as a share of the quality's, never below 1. */
export const MIN_SHARE = 0.6;
export const RAISE_AFTER_MS = 10_000;
export const RAISE_AFTER_MAX_MS = 160_000;
/** A step up that turns slow within this long backs off. */
export const PROBATION_MS = 4_000;

/** The pixel ratios from `max` down by STEP to MIN_SHARE of it (at least 1). */
export function resolutionLevels(max: number) {
  const min = Math.max(1, max * MIN_SHARE);
  const levels = [max];
  for (let ratio = max - STEP; ratio >= min - 1e-6; ratio -= STEP) levels.push(Math.round(ratio * 100) / 100);
  return levels;
}

export function createDynamicResolution(max: number) {
  let levels = resolutionLevels(max);
  let level = 0;
  let windowStart = -1;
  let last = -1;
  let frames = 0;
  // The first window after a switch holds its reallocation.
  let discard = false;
  let goodSince = -1;
  let raiseAfter = RAISE_AFTER_MS;
  let raisedAt = -1;
  const restart = () => {
    windowStart = last = -1;
    frames = 0;
  };
  const change = (next: number, now: number) => {
    level = next;
    restart();
    discard = true;
    goodSince = -1;
    raisedAt = now;
    return levels[level];
  };
  return {
    get pixelRatio() {
      return levels[level];
    },
    /** A new largest ratio (the quality changed): back to it. */
    reset(nextMax: number) {
      levels = resolutionLevels(nextMax);
      level = 0;
      raiseAfter = RAISE_AFTER_MS;
      goodSince = raisedAt = -1;
      discard = false;
      restart();
    },
    /** The view changed (another stage, another cost): measure afresh and try a step up sooner. */
    settle() {
      raiseAfter = RAISE_AFTER_MS;
      goodSince = raisedAt = -1;
      restart();
    },
    /** Each drawn frame's time (requestAnimationFrame's); the new pixel ratio when it changes. */
    frame(now: number): number | null {
      if (last < 0 || now - last > HITCH_MS) {
        windowStart = last = now;
        frames = 0;
        return null;
      }
      last = now;
      frames++;
      if (now - windowStart < WINDOW_MS) return null;
      const mean = (now - windowStart) / frames;
      windowStart = now;
      frames = 0;
      if (discard) {
        discard = false;
        return null;
      }
      if (mean > SLOW_MS) {
        goodSince = -1;
        if (raisedAt >= 0 && now - raisedAt < PROBATION_MS) raiseAfter = Math.min(raiseAfter * 2, RAISE_AFTER_MAX_MS);
        raisedAt = -1;
        return level < levels.length - 1 ? change(level + 1, -1) : null;
      }
      if (mean > GOOD_MS) {
        goodSince = -1;
        return null;
      }
      if (goodSince < 0) goodSince = now - WINDOW_MS;
      if (level > 0 && now - goodSince >= raiseAfter) return change(level - 1, now);
      return null;
    },
  };
}
