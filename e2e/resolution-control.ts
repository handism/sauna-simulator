import { chooseSceneSetting } from './settings-controls';
import { expect, type Locator, type Page } from '@playwright/test';
import { QUALITY } from '../src/components/3d/quality.ts';

// Sets a step of dynamic resolution (src/components/3d/dynamicResolution.ts) for captures on a
// display of ratio 1.5 at the standard quality (or 2 at the high one). Frames made slower at a larger
// pixel ratio (one drawn in round(4r) - 3 display frames, as dynamic-resolution.e2e.ts does; a step
// down that does not make frames faster is undone) step the ratio down; a quality change returns to the largest. The frames then get a held time: no window of the control loop ends, so the ratio
// holds whatever the frames cost (a view may miss 60 fps at 1.5 on its own). With reduced motion
// the water and the lighting are still, so the held time changes no image.

/** The init script: wraps requestAnimationFrame. */
export function controlFrames() {
  const w = window as unknown as { suiSlow?: boolean; suiHold?: number };
  const request = window.requestAnimationFrame.bind(window);
  let drawn = -1;
  const frame = (callback: FrameRequestCallback) => (time: number) => {
    const canvas = document.querySelector<HTMLCanvasElement>('.sauna-3d-canvas canvas');
    if (w.suiSlow && canvas?.clientWidth) {
      const every = Math.max(1, Math.round((4 * canvas.width) / canvas.clientWidth) - 3);
      if (time !== drawn && time - drawn < (every - 0.5) * (1000 / 60)) {
        request(frame(callback));
        return;
      }
      drawn = time;
    }
    callback(w.suiHold ?? time);
  };
  window.requestAnimationFrame = (callback) => request(frame(callback));
}

function frames(page: Page, mode: 'slow' | 'hold') {
  return page.evaluate((value) => {
    const w = window as unknown as { suiSlow: boolean; suiHold?: number };
    w.suiSlow = value === 'slow';
    w.suiHold = value === 'hold' ? performance.now() : undefined;
  }, mode);
}

/**
 * Holds `ratio` (the quality's own through a quality change, or the next step down from the
 * current one). The display's ratio must reach the quality's.
 */
export async function holdRatio(page: Page, scene: Locator, ratio: string, quality: 'standard' | 'high' = 'standard') {
  if (ratio === String(QUALITY[quality].pixelRatio)) {
    await frames(page, 'hold');
    await chooseSceneSetting(page, '3Dの画質', 'low');
    await expect(scene).toHaveAttribute('data-pixel-ratio', '1');
    await chooseSceneSetting(page, '3Dの画質', quality);
  } else {
    await frames(page, 'slow');
    await expect(scene).toHaveAttribute('data-pixel-ratio', ratio, { timeout: 15_000 });
    await frames(page, 'hold');
  }
  await expect(scene).toHaveAttribute('data-pixel-ratio', ratio);
  // A few frames at the ratio (the held time still draws them).
  await page.waitForTimeout(1_500);
  await expect(scene).toHaveAttribute('data-pixel-ratio', ratio);
}
