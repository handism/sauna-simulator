import { chooseSceneSetting, switchSceneMode } from './settings-controls';
import { expect, test } from '@playwright/test';
import { rendererCaptureStyle } from './scene-capture';

// Automatic lighting follows the real time since entering (lighting.ts timeOfDay). Date.now alone
// is held at a value the test sets, so the time of day is exact whatever the capture takes; the
// render loop, timers and requestAnimationFrame keep the real clock. Review captures of the blends
// between the source scenes, not a visual-quality pass.
test('automatic lighting follows the time since entering, across stages and a 3D remount', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    const w = window as unknown as { suiNow: number };
    w.suiNow = Date.now();
    Date.now = () => w.suiNow;
  });
  const setMinutes = (minutes: number) =>
    page.evaluate((ms) => {
      const w = window as unknown as { suiNow: number; suiEntered: number };
      w.suiNow = w.suiEntered + ms;
    }, minutes * 60_000);
  await page.goto('?view=3d&frameRate=full');
  await page.evaluate(() => {
    const w = window as unknown as { suiNow: number; suiEntered: number };
    w.suiEntered = w.suiNow;
  });
  await page.getByRole('button', { name: '音なしで入室する' }).click();
  const scene = page.locator('.sauna-3d-canvas');
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
  await chooseSceneSetting(page, '3Dの画質', 'standard');
  await expect(page.getByLabel('3Dの時間帯')).toHaveValue('auto');
  // Entering, and the clock standing still, keep the day.
  await expect(scene).toHaveAttribute('data-time-of-day', '0.000');
  const press = async (key: string, count: number) => {
    await scene.focus();
    for (let n = 0; n < count; n++) await page.keyboard.press(key);
  };
  const samples: object[] = [];
  const minutes = [0, 12, 13.5, 15, 27, 28.5, 30, 45];
  const stages = [
    ['sauna', '水風呂へ'],
    ['water', '外気浴へ'],
    ['totonou', null],
  ] as const;
  for (const [stage, next] of stages) {
    await expect(scene).toHaveAttribute('data-stage', stage);
    await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
    await page.waitForTimeout(1200);
    for (const minute of minutes) {
      await setMinutes(minute);
      // Reduced motion applies the target at once. Each scene holds for 12 of its 15 minutes and
      // blends into the next over the last 3; 45 minutes stays at night.
      const expected = { 0: 0, 12: 0, 13.5: 0.5, 15: 1, 27: 1, 28.5: 1.5, 30: 2, 45: 2 }[minute]!.toFixed(3);
      await expect(scene).toHaveAttribute('data-time-of-day', expected);
      for (let heading = 0; heading < 8; heading++) {
        const file = `${stage}-${minute}-${heading}.jpg`;
        await page.waitForTimeout(100);
        await scene
          .locator('canvas')
          .screenshot({ path: info.outputPath(file), type: 'jpeg', quality: 85, style: rendererCaptureStyle });
        samples.push({
          stage,
          minute,
          heading,
          file,
          metrics: await scene.evaluate((element) => ({ ...(element as HTMLElement).dataset })),
        });
        await press('ArrowRight', 10);
      }
      await press('ArrowLeft', 80);
    }
    await page.getByRole('button', { name: '操作を表示', exact: true }).click();
    if (next) {
      // The stage change keeps the time of day: it depends on the clock only.
      await setMinutes(10);
      await page.getByRole('button', { name: next, exact: true }).click();
    }
  }
  // A new 3D scene resumes the session's time of day instead of restarting the day.
  await setMinutes(28.5);
  await expect(scene).toHaveAttribute('data-time-of-day', '1.500');
  await switchSceneMode(page, '2Dに切り替え');
  await expect(scene).toHaveCount(0);
  await switchSceneMode(page, '3Dを試す');
  await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 30_000 });
  await expect(scene).toHaveAttribute('data-time-of-day', '1.500');
  // A fixed choice still wins over the clock.
  await chooseSceneSetting(page, '3Dの時間帯', 'day');
  await expect(scene).toHaveAttribute('data-time-of-day', '0.000');
  expect(errors).toEqual([]);
  await info.attach('auto-lighting', {
    contentType: 'application/json',
    body: JSON.stringify(
      { browser: browser.version(), viewport: page.viewportSize(), quality: 'standard', samples, errors },
      null,
      2,
    ),
  });
});
