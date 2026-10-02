import { expect, type Locator, type Page } from '@playwright/test';

// Sets a step of dynamic resolution (src/components/3d/dynamicResolution.ts) for captures on a
// display of ratio 1.5 at the standard quality. Frames made slow on the CPU (a busy wait in every
// animation frame, as dynamic-resolution.e2e.ts does) step the ratio down; a quality change returns
// to the largest. The frames then get a held time: no window of the control loop ends, so the ratio
// holds whatever the frames cost (a view may miss 60 fps at 1.5 on its own). With reduced motion
// the water and the lighting are still, so the held time changes no image.

/** The init script: wraps requestAnimationFrame. */
export function controlFrames() {
  const w = window as unknown as { suiSlow?: boolean; suiHold?: number };
  const request = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) =>
    request((time) => {
      if (w.suiSlow) for (const end = performance.now() + 30; performance.now() < end;);
      callback(w.suiHold ?? time);
    });
}

function frames(page: Page, mode: 'slow' | 'hold') {
  return page.evaluate((value) => {
    const w = window as unknown as { suiSlow: boolean; suiHold?: number };
    w.suiSlow = value === 'slow';
    w.suiHold = value === 'hold' ? performance.now() : undefined;
  }, mode);
}

/** Holds `ratio` ('1.5' through a quality change, or the next step down from the current one). */
export async function holdRatio(page: Page, scene: Locator, ratio: string) {
  if (ratio === '1.5') {
    await frames(page, 'hold');
    const quality = page.getByLabel('3Dの画質');
    await quality.selectOption('low');
    await expect(scene).toHaveAttribute('data-pixel-ratio', '1');
    await quality.selectOption('standard');
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
