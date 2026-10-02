import { expect, test, type Page } from '@playwright/test';

// Dynamic resolution (src/components/3d/dynamicResolution.ts) on a display of ratio 1.5 at the
// standard quality: frames made slow on the CPU (a busy wait in every animation frame, set by
// window.suiSlow) step the pixel ratio down to 1, and frames within 60 fps again bring a trial step
// up after RAISE_AFTER_MS (10 s). A check of the control loop, not of a GPU's frame budget.
test.use({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1.5, reducedMotion: 'reduce' });

function slowFrames() {
  const w = window as unknown as { suiSlow?: boolean };
  const request = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) =>
    request((time) => {
      if (w.suiSlow) for (const end = performance.now() + 30; performance.now() < end;);
      callback(time);
    });
}

async function enter(page: Page, query: string) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(slowFrames);
  await page.goto(`?view=3d${query}`);
  await page.getByRole('button', { name: '静かに入室する' }).click();
  const scene = page.locator('.sauna-3d-canvas');
  await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 30_000 });
  await page.getByLabel('3Dの画質').selectOption('standard');
  await expect(scene).toHaveAttribute('data-pixel-ratio', '1.5');
  const slow = (on: boolean) =>
    page.evaluate((value) => ((window as unknown as { suiSlow: boolean }).suiSlow = value), on);
  return { scene, errors, slow };
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
  await expect(scene).toHaveAttribute('data-pixel-ratio', '1.25', { timeout: 20_000 });
  // A quality change returns to its ratio at once.
  await page.getByLabel('3Dの画質').selectOption('low');
  await expect(scene).toHaveAttribute('data-pixel-ratio', '1');
  await page.getByLabel('3Dの画質').selectOption('standard');
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
