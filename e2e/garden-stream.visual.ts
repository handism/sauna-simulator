import { expect, test } from '@playwright/test';
import { controlFrames } from './resolution-control';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';
import { chooseSceneSetting } from './settings-controls';

const QUALITY = process.env.STREAM_QUALITY ?? 'standard';
if (QUALITY !== 'standard' && QUALITY !== 'high') throw new Error('Invalid STREAM_QUALITY');
test.use({ deviceScaleFactor: QUALITY === 'high' ? 2 : 1 });

// Fixed camera and lighting, settled temporal history at each held animation time.
// Inspect the stream inside the images separately from the surrounding moving grass.
test('capture the garden stream at held times with and without reduced motion', async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(controlFrames);
  await page.goto(`?view=3d&quality=${QUALITY}&sound=off&resolution=fixed&frameRate=full`);
  await chooseSceneSetting(page, '3Dの時間帯', 'day');
  await page.getByRole('button', { name: '入室する', exact: true }).click();
  const scene = page.locator('.sauna-3d-canvas');
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 40_000 });
  await expect(scene).toHaveAttribute('data-quality', QUALITY);
  await expect(scene).toHaveAttribute('data-pixel-ratio', QUALITY === 'high' ? '2' : '1');
  await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
  await expect(scene).toHaveAttribute('data-stage', 'water');
  await page.getByRole('button', { name: '外気浴へ', exact: true }).click();
  await expect(scene).toHaveAttribute('data-stage', 'totonou');
  await page.waitForTimeout(1500);
  const base = await page.evaluate(() => performance.now());
  const samples: { reduced: boolean; milliseconds: number; file: string }[] = [];
  for (const reduced of [false, true]) {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    for (const step of [0, 500, 1000]) {
      const milliseconds = base + (reduced ? 2000 : 0) + step;
      await page.evaluate((time) => {
        (window as unknown as { suiHold: number }).suiHold = time;
      }, milliseconds);
      await settleRenderer(page);
      const file = `${reduced ? 'still' : 'flow'}-${step}.png`;
      await scene.locator('canvas').screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
      samples.push({ reduced, milliseconds, file });
    }
  }
  expect(errors).toEqual([]);
  await info.attach('garden-stream', {
    contentType: 'application/json',
    body: JSON.stringify({
      browser: browser.version(),
      quality: QUALITY,
      samples,
      metrics: await scene.evaluate((el) => ({ ...(el as HTMLElement).dataset })),
    }),
  });
});
