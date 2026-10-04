import { expect, test, type Page } from '@playwright/test';
import { timeFrames } from './gpu-timer';
import { chooseSceneSetting } from './settings-controls';

// A still view draws at 30 fps, a turning one and the löyly's steam at the display's rate
// (src/components/3d/frameRate.ts). Compared with the animation frames the browser gives, so a
// slow headless display rate does not fail it. Not a power or GPU time measurement.

type Counted = Window & { suiMeasure?: boolean; suiFrameAt: number[]; suiTicks?: number };

/** Drawn frames and animation frames over `ms`, while `during` runs. */
async function count(page: Page, ms: number, during: () => Promise<void> = () => page.waitForTimeout(ms)) {
  await page.evaluate(() => {
    const w = window as unknown as Counted;
    w.suiFrameAt.length = 0;
    w.suiTicks = 0;
    w.suiMeasure = true;
    const tick = () => {
      if (!w.suiMeasure) return;
      w.suiTicks!++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await during();
  return page.evaluate(() => {
    const w = window as unknown as Counted;
    w.suiMeasure = false;
    return { drawn: w.suiFrameAt.length, ticks: w.suiTicks! };
  });
}

test('a still view draws every other frame, a turn and the steam every frame', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(timeFrames);
  await page.goto('?view=3d');
  await page.getByRole('button', { name: '音なしで入室する' }).click();
  const scene = page.locator('.sauna-3d-canvas');
  await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 30_000 });
  await expect(scene).toHaveAttribute('data-frame-rate', 'auto');
  await chooseSceneSetting(page, '3Dの画質', 'low');
  await expect(scene).toHaveAttribute('data-quality', 'low');
  await page.waitForTimeout(1500);

  const still = await count(page, 2000);
  expect(still.ticks).toBeGreaterThan(40);
  expect(still.drawn / still.ticks).toBeGreaterThan(0.35);
  expect(still.drawn / still.ticks).toBeLessThan(0.65);

  // The stage's panels cover the middle of the scene.
  await page.getByRole('button', { name: 'UI非表示', exact: true }).click();
  const box = (await scene.boundingBox())!;
  const turn = await count(page, 2000, async () => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 0; i < 40; i++) {
      await page.mouse.move(box.x + box.width / 2 + i * 4, box.y + box.height / 2);
      await page.waitForTimeout(50);
    }
    await page.mouse.up();
  });
  expect(turn.drawn / turn.ticks).toBeGreaterThan(0.85);

  await page.getByRole('button', { name: 'UI表示', exact: true }).click();
  await page.waitForTimeout(1500);
  const steam = await count(page, 2000, async () => {
    await page.getByRole('button', { name: 'ロウリュ' }).click();
    await page.waitForTimeout(2000);
  });
  expect(steam.drawn / steam.ticks).toBeGreaterThan(0.85);
  expect(errors).toEqual([]);
});

test('?frameRate=full draws every frame of a still view', async ({ page }) => {
  await page.addInitScript(timeFrames);
  await page.goto('?view=3d&frameRate=full');
  await page.getByRole('button', { name: '音なしで入室する' }).click();
  const scene = page.locator('.sauna-3d-canvas');
  await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 30_000 });
  await expect(scene).toHaveAttribute('data-frame-rate', 'full');
  await chooseSceneSetting(page, '3Dの画質', 'low');
  await expect(scene).toHaveAttribute('data-quality', 'low');
  await page.waitForTimeout(1500);
  const still = await count(page, 2000);
  expect(still.drawn / still.ticks).toBeGreaterThan(0.85);
});
