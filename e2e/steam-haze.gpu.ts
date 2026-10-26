import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { chooseSceneSetting } from './settings-controls';
import { timeFrames } from './gpu-timer';
import { rendererCaptureStyle } from './scene-capture';

// The room's steam after a löyly and the heat haze over the stove (steamHaze.ts, heatShimmer.ts):
// the frame cost (draws repeated REPEAT times, interval / REPEAT) of the still sauna view and of
// the seconds after two löyly, and stills of how the steam looks at each time of day and after
// looking around. STEAM_BASELINE_DIST (playwright.steam.config.ts) serves the build before them,
// which runs the same steps (the löyly then has its puff only). Motion is not reduced: reduced
// motion turns the shimmer off.
const REPEAT = Number(process.env.STEAM_REPEAT ?? 3);
const LIGHTINGS = ['day', 'evening', 'night'] as const;
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });

async function measure(page: Page, ms: number) {
  await page.evaluate(() => {
    const w = window as any;
    w.suiFrameAt = [];
    w.suiGpuMs = [];
    w.suiMeasure = true;
  });
  await page.waitForTimeout(ms);
  const frames: number[] = await page.evaluate(() => {
    const w = window as any;
    w.suiMeasure = false;
    return w.suiFrameAt;
  });
  expect(frames.length).toBeGreaterThan(20);
  return { frames: frames.length, intervalMs: (frames.at(-1)! - frames[0]) / (frames.length - 1) / REPEAT };
}

test(`steam haze ${process.env.STEAM_RUN ?? 'after1'}`, async ({ page, browser }, info) => {
  test.setTimeout(600_000);
  await page.addInitScript(timeFrames, REPEAT);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const scripts: Record<string, string> = {};
  page.on('response', async (response) => {
    if (response.url().endsWith('.js')) {
      scripts[new URL(response.url()).pathname] = createHash('sha256')
        .update(await response.body())
        .digest('hex');
    }
  });
  await page.goto('?sound=off&view=3d&quality=standard&resolution=fixed&frameRate=full');
  await page.getByRole('button', { name: '入室する', exact: true }).click();
  const scene = page.locator('.sauna-3d-canvas');
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 120_000 });
  await expect(scene).toHaveAttribute('data-stage', 'sauna');
  const rows: object[] = [];
  const snap = async (name: string) => {
    const image = await scene.locator('canvas').screenshot({ type: 'png', style: rendererCaptureStyle });
    await info.attach(name, { body: image, contentType: 'image/png' });
    const data = await scene.evaluate((e) => ({ ...(e as HTMLElement).dataset }));
    return { haze: data.steamHaze ?? null, shimmer: data.heatShimmer ?? null };
  };
  const hide = () => page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
  const show = () => page.getByRole('button', { name: '操作を表示', exact: true }).click();

  // Still view without a löyly (the shimmer only), every time of day first: the steam lingers.
  for (const lighting of LIGHTINGS) {
    await chooseSceneSetting(page, '3Dの時間帯', lighting);
    await expect(scene).toHaveAttribute('data-lighting', lighting);
    await hide();
    await page.waitForTimeout(2500);
    const cost = await measure(page, 4000);
    rows.push({ lighting, phase: 'idle', ...cost, ...(await snap(`${lighting}-idle`)) });
    await show();
  }
  for (const lighting of LIGHTINGS) {
    await chooseSceneSetting(page, '3Dの時間帯', lighting);
    await expect(scene).toHaveAttribute('data-lighting', lighting);
    await page.waitForTimeout(1500);
    const loyly = page.getByRole('button', { name: /ロウリュ/ });
    await loyly.click();
    await loyly.click();
    const start = Date.now();
    await hide();
    await page.waitForTimeout(3000 - (Date.now() - start));
    rows.push({ lighting, phase: 'loyly3', ...(await snap(`${lighting}-loyly3`)) });
    // The puff (6 s) is gone; the steam stays.
    await page.waitForTimeout(7000 - (Date.now() - start));
    const cost = await measure(page, 4000);
    rows.push({ lighting, phase: 'loyly7-11', ...cost, ...(await snap(`${lighting}-loyly11`)) });
    // Looking around in the steam: left toward the glass, then up under the ceiling.
    await scene.focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(1200);
    rows.push({ lighting, phase: 'look-left', ...(await snap(`${lighting}-look-left`)) });
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(1200);
    rows.push({ lighting, phase: 'look-up', ...(await snap(`${lighting}-look-up`)) });
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowDown');
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(25000 - (Date.now() - start));
    rows.push({ lighting, phase: 'loyly25', ...(await snap(`${lighting}-loyly25`)) });
    await show();
  }
  expect(errors).toEqual([]);
  await info.attach('steam-haze', {
    contentType: 'application/json',
    body: JSON.stringify({
      run: process.env.STEAM_RUN ?? 'after1',
      browser: browser.version(),
      repeat: REPEAT,
      scripts,
      rows,
    }),
  });
});
