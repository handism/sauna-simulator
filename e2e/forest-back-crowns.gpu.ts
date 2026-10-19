import { expect, test } from '@playwright/test';
import { chooseSceneSetting } from './settings-controls';
import { settleRenderer } from './scene-capture';
import { timeFrames } from './gpu-timer';
import { verifyForestBuild } from './forest-build';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
for (const run of (process.env.FOREST_COST_RUNS ?? 'product').split(',')) {
  test(`far crown cost ${run}`, async ({ page, browser }, info) => {
    test.setTimeout(180_000);
    await page.addInitScript(timeFrames, 3);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto('?sound=off&view=3d&quality=standard&resolution=fixed&frameRate=full');
    await page.getByRole('button', { name: '入室する', exact: true }).click();
    const scene = page.locator('.sauna-3d-canvas');
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
    const forestBuild = await verifyForestBuild(page);
    const samples = [];
    for (const [stage, next] of [
      ['sauna', '水風呂へ'],
      ['water', '外気浴へ'],
      ['totonou', null],
    ] as const) {
      await expect(scene).toHaveAttribute('data-stage', stage);
      await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
      await scene.focus();
      for (let i = 0; i < 32; i++) await page.keyboard.press('ArrowDown');
      for (let i = 0; i < 14; i++) await page.keyboard.press('ArrowUp');
      for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
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
        await page.waitForTimeout(3000);
        const frames: number[] = await page.evaluate(() => {
          const w = window as any;
          w.suiMeasure = false;
          return w.suiFrameAt;
        });
        expect(frames.length).toBeGreaterThan(20);
        samples.push({
          stage,
          lighting,
          frames: frames.length,
          intervalMeanMs: (frames.at(-1)! - frames[0]) / (frames.length - 1) / 3,
          metrics: await scene.evaluate((e) => ({ ...(e as HTMLElement).dataset })),
        });
      }
      await page.getByRole('button', { name: '操作を表示', exact: true }).click();
      if (next) await page.getByRole('button', { name: next, exact: true }).click();
    }
    expect(errors).toEqual([]);
    const baseline = process.env.FOREST_BASELINE_DIST;
    const dist = baseline ?? 'dist';
    const bundle = readdirSync(join(dist, 'assets')).filter((f) => /^SaunaScene-.*\.js$/.test(f));
    expect(bundle.length).toBe(1);
    const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
    await info.attach('forest-cost', {
      contentType: 'application/json',
      body: JSON.stringify({
        run,
        forestBuild,
        browser: browser.version(),
        baseline: !!baseline,
        repeat: 3,
        dpr: 1,
        size: [1280, 800],
        heading: 20,
        pitch: -0.01,
        samples,
        errors,
        sourceHash: hash(baseline ? join(dirname(baseline), 'farForest.before.ts') : 'src/components/3d/farForest.ts'),
        bundleHash: hash(join(dist, 'assets', bundle[0])),
        inputs: Object.fromEntries(
          [
            'public/models/sauna.glb',
            'public/models/sauna-garden.glb',
            'public/models/irradiance.bin',
            'public/models/reflection.bin',
          ].map((p) => [p, hash(p)]),
        ),
      }),
    });
  });
}
