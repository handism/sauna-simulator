import { chooseSceneSetting } from './settings-controls';
import { expect, test, type Page } from '@playwright/test';

// Dynamic resolution (src/components/3d/dynamicResolution.ts) on a display of ratio 1.5 at the
// standard quality: frames made slower at a larger pixel ratio (one drawn in 3 display frames at
// 1.5, 2 at 1.25 and each at 1, set by window.suiSlow; see slowEvery) step the pixel ratio down to 1,
// and frames within 60 fps again bring a trial step up after RAISE_AFTER_MS (10 s). Animation frames held
// at 30 fps (window.suiCap, as a low power mode does) are as slow at any ratio: the step down is
// undone. A check of the control loop, not of a GPU's frame budget.
// The trace's screencast drops display frames now and then (0-4 in 12 s at ratio 1, none without
// it); under a machine load enough 1 s windows passed GOOD_MS that the step up never came. Its timing
// is the subject here, so no trace (a failure attaches the frame windows instead).
test.use({
  viewport: { width: 1200, height: 800 },
  deviceScaleFactor: 1.5,
  reducedMotion: 'reduce',
  trace: 'off',
});

function slowFrames() {
  const w = window as unknown as { suiSlow?: boolean; suiCap?: boolean };
  const request = window.requestAnimationFrame.bind(window);
  // Every other display frame, whoever asks for it.
  let lastTime = -1;
  let skip = false;
  // Slow frames: a canvas at pixel ratio r draws once in round(4r) - 3 display frames, whatever the
  // frame's own cost. A busy wait in proportion to the pixels is rounded up to whole display frames,
  // so a step down gained nothing (and was undone) whenever the waits at both ratios fell in one.
  let drawn = -1;
  const frame = (callback: FrameRequestCallback) => (time: number) => {
    if (time !== lastTime) {
      lastTime = time;
      skip = !skip;
    }
    if (w.suiCap && skip) {
      request(frame(callback));
      return;
    }
    const canvas = document.querySelector<HTMLCanvasElement>('.sauna-3d-canvas canvas');
    if (w.suiSlow && canvas?.clientWidth) {
      const every = Math.max(1, Math.round((4 * canvas.width) / canvas.clientWidth) - 3);
      if (time !== drawn && time - drawn < (every - 0.5) * (1000 / 60)) {
        request(frame(callback));
        return;
      }
      drawn = time;
    }
    callback(time);
  };
  window.requestAnimationFrame = (callback) => request(frame(callback));
}

async function enter(page: Page, query: string) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(slowFrames);
  await page.goto(`?sound=off&quality&view=3d&frameRate=full${query}`);
  await page.getByRole('button', { name: '入室する', exact: true }).click();
  const scene = page.locator('.sauna-3d-canvas');
  await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 30_000 });
  await chooseSceneSetting(page, '3Dの画質', 'standard');
  await expect(scene).toHaveAttribute('data-pixel-ratio', '1.5');
  const slow = (on: boolean) =>
    page.evaluate((value) => ((window as unknown as { suiSlow: boolean }).suiSlow = value), on);
  const cap = (on: boolean) =>
    page.evaluate((value) => ((window as unknown as { suiCap: boolean }).suiCap = value), on);
  return { scene, errors, slow, cap };
}

test('slow frames step the pixel ratio down and a run within 60 fps tries it back up', async ({ page }) => {
  test.setTimeout(90_000);
  const { scene, errors, slow } = await enter(page, '');
  await expect(scene).toHaveAttribute('data-resolution', 'auto');
  await slow(true);
  await expect(scene).toHaveAttribute('data-pixel-ratio', '1.25', { timeout: 10_000 });
  await expect(scene).toHaveAttribute('data-pixel-ratio', '1', { timeout: 10_000 });
  // The canvas follows: 1200×800 CSS pixels at ratio 1.
  expect(await scene.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBe(1200);
  await slow(false);
  // The step up needs real frames within the budget at ratio 1 (about 60% of it on the development
  // Mac). On failure, attach the 1 s window means the control saw, to tell a slow GPU or dropped
  // display frames from a fault of the control.
  await page.evaluate(() => {
    const w = window as unknown as { suiTimes: number[] };
    w.suiTimes = [];
    const tick = (time: number) => {
      w.suiTimes.push(time);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  try {
    await expect(scene).toHaveAttribute('data-pixel-ratio', '1.25', { timeout: 20_000 });
  } catch (error) {
    const times = await page.evaluate(() => (window as unknown as { suiTimes: number[] }).suiTimes);
    const windows: { mean: number; max: number }[] = [];
    for (let start = 0, k = 1; k < times.length; k++)
      if (times[k] - times[start] >= 1000 || k === times.length - 1) {
        const gaps = times.slice(start + 1, k + 1).map((t, n) => t - times[start + n]);
        windows.push({ mean: (times[k] - times[start]) / (k - start), max: Math.max(...gaps) });
        start = k;
      }
    await test.info().attach('frame-windows', {
      body: JSON.stringify({ budgetMs: 1000 / 60, goodMs: (1000 / 60) * 1.04, windows }, null, 1),
      contentType: 'application/json',
    });
    throw error;
  }
  // A quality change returns to its ratio at once.
  await chooseSceneSetting(page, '3Dの画質', 'low');
  await expect(scene).toHaveAttribute('data-pixel-ratio', '1');
  await chooseSceneSetting(page, '3Dの画質', 'standard');
  await expect(scene).toHaveAttribute('data-pixel-ratio', '1.5');
  expect(errors).toEqual([]);
});

test('frames held at 30 fps undo the step down and keep the quality ratio', async ({ page }) => {
  test.setTimeout(90_000);
  const { scene, errors, cap } = await enter(page, '');
  await cap(true);
  await expect(scene).toHaveAttribute('data-pixel-ratio', '1.25', { timeout: 10_000 });
  await expect(scene).toHaveAttribute('data-pixel-ratio', '1.5', { timeout: 10_000 });
  // Held (HOLD_MS, 10 s at first): no further step down.
  await page.waitForTimeout(6_000);
  await expect(scene).toHaveAttribute('data-pixel-ratio', '1.5');
  expect(errors).toEqual([]);
});

test('?resolution=fixed keeps the quality pixel ratio under slow frames', async ({ page }) => {
  test.setTimeout(60_000);
  const { scene, errors, slow } = await enter(page, '&resolution=fixed');
  await expect(scene).toHaveAttribute('data-resolution', 'fixed');
  await slow(true);
  await page.waitForTimeout(6_000);
  await expect(scene).toHaveAttribute('data-pixel-ratio', '1.5');
  expect(errors).toEqual([]);
});
