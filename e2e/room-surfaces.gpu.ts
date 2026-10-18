import { expect, test } from '@playwright/test';
import { chooseSceneSetting } from './settings-controls';
import { timeFrames } from './gpu-timer';
import { settleRenderer } from './scene-capture';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
for (const variant of (process.env.ROOM_COST_VARIANTS ?? 'product').split(',')) {
  test(`room light cost ${variant}`, async ({ page, browser }, info) => {
    test.setTimeout(240_000);
    await page.addInitScript(timeFrames, 3);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    const views = {
      seated: null,
      bench: { position: [-3.2, 1.65, -2.78], target: [-3.6, 0.65, -4.5], fov: 58 },
      left: { position: [-3.2, 1.65, -2.78], target: [-6.09, 1.6, -2.8], fov: 58 },
      ceiling: { position: [-3.2, 1.65, -2.78], target: [-3.3, 3.285, -3.4], fov: 58 },
    };
    let view: keyof typeof views = 'seated';
    await page.route('**/sauna.scene.json', async (route) => {
      const definition = await (await route.fetch()).json();
      if (views[view]) definition.views.sauna = views[view];
      await route.fulfill({ json: definition });
    });
    const samples: object[] = [];
    for (view of Object.keys(views) as (keyof typeof views)[]) {
      await page.goto(
        `?sound=off&view=3d&quality=standard&resolution=fixed&frameRate=full${view === 'seated' ? '' : '&camera=review'}`,
      );
      await page.getByRole('button', { name: '入室する', exact: true }).click();
      const scene = page.locator('.sauna-3d-canvas');
      await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
      expect(await page.evaluate(() => Boolean((window as any).suiTimer))).toBe(true);
      for (const lighting of ['day', 'night']) {
        await chooseSceneSetting(page, '3Dの時間帯', lighting);
        await expect(scene).toHaveAttribute('data-lighting', lighting);
        await settleRenderer(page);
        await page.evaluate(() => {
          const w = window as any;
          w.suiFrameAt = [];
          w.suiGpuMs = [];
          w.suiMeasure = true;
        });
        await page.waitForTimeout(4000);
        await page.evaluate(() => {
          (window as any).suiMeasure = false;
        });
        const frameAt: number[] = await page.evaluate(() => (window as any).suiFrameAt);
        expect(frameAt.length).toBeGreaterThan(20);
        samples.push({
          view,
          lighting,
          frames: frameAt.length,
          intervalMeanMs: (frameAt.at(-1)! - frameAt[0]) / (frameAt.length - 1) / 3,
          metrics: await scene.evaluate((e) => ({ ...(e as HTMLElement).dataset })),
        });
      }
    }
    expect(errors).toEqual([]);
    await info.attach('room-cost.json', {
      contentType: 'application/json',
      body: JSON.stringify({
        variant,
        browser: browser.version(),
        repeat: 3,
        dpr: 1,
        size: [1280, 800],
        samples,
        errors,
        inputs: Object.fromEntries(
          ['public/models/sauna.glb', 'public/models/irradiance.bin', 'public/models/room-irradiance.bin'].map((f) => [
            f,
            createHash('sha256').update(readFileSync(f)).digest('hex'),
          ]),
        ),
        source: createHash('sha256').update(readFileSync('src/components/3d/roomIrradiance.ts')).digest('hex'),
      }),
    });
  });
}
