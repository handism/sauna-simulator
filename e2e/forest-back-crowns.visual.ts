import { expect, test } from '@playwright/test';
import { chooseSceneSetting } from './settings-controls';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';
import { omitFarCrowns } from './forest-back-crowns-controls';
import { verifyForestBuild } from './forest-build';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const quick = process.env.FOREST_QUICK === '1';
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
for (const run of quick ? ['before1', 'after1'] : ['before1', 'after1', 'after2', 'before2']) {
  test(`far crowns ${run}`, async ({ page, browser }, info) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    if (run.startsWith('before')) await page.addInitScript(omitFarCrowns);
    await page.goto('?sound=off&view=3d&quality=standard&resolution=fixed&frameRate=full');
    await page.getByRole('button', { name: '入室する', exact: true }).click();
    const scene = page.locator('.sauna-3d-canvas');
    const canvas = scene.locator('canvas');
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
    const forestBuild = await verifyForestBuild(page);
    const captures = [];
    for (const [stage, next] of [
      ['sauna', '水風呂へ'],
      ['water', '外気浴へ'],
      ['totonou', null],
    ] as const) {
      await expect(scene).toHaveAttribute('data-stage', stage);
      if (!quick || stage === 'totonou') {
        await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
        await scene.focus();
        for (let i = 0; i < 32; i++) await page.keyboard.press('ArrowDown');
        for (let i = 0; i < 14; i++) await page.keyboard.press('ArrowUp');
        const headings = quick ? [20] : [0, 20, 60];
        let heading = 0;
        const previous = new Map<string, Buffer>();
        for (const target of headings) {
          // Selecting a time of day focuses the settings menu, so every turn must
          // explicitly return keyboard input to the actual look-control surface.
          await scene.focus();
          await expect(scene).toBeFocused();
          for (let i = heading; i < target; i++) await page.keyboard.press('ArrowRight');
          heading = target;
          for (const lighting of quick ? ['day'] : ['day', 'evening', 'night']) {
            await chooseSceneSetting(page, '3Dの時間帯', lighting);
            await expect(scene).toHaveAttribute('data-lighting', lighting);
            await settleRenderer(page);
            const file = `${stage}-${lighting}-${target}.png`;
            const png = await canvas.screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
            if (previous.has(lighting)) expect(png.equals(previous.get(lighting)!)).toBe(false);
            previous.set(lighting, png);
            captures.push({
              stage,
              lighting,
              heading: target,
              file,
              metrics: await scene.evaluate((e) => ({ ...(e as HTMLElement).dataset })),
            });
          }
        }
        if (!quick && stage === 'totonou') {
          await scene.focus();
          for (let i = 0; i < heading; i++) await page.keyboard.press('ArrowLeft');
          await chooseSceneSetting(page, '3Dの時間帯', 'day');
          for (const season of ['autumn', 'winter']) {
            await chooseSceneSetting(page, '3Dの季節', season);
            await expect(scene).toHaveAttribute('data-season', season);
            await settleRenderer(page);
            const file = `${stage}-${season}-day-0.png`;
            await canvas.screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
            captures.push({
              stage,
              lighting: 'day',
              heading: 0,
              season,
              file,
              metrics: await scene.evaluate((e) => ({ ...(e as HTMLElement).dataset })),
            });
          }
        }
        await page.getByRole('button', { name: '操作を表示', exact: true }).click();
      }
      if (next) await page.getByRole('button', { name: next, exact: true }).click();
    }
    const controls = await page.evaluate(() => (window as any).farCrownControls ?? 0);
    expect(controls > 0).toBe(run.startsWith('before'));
    expect(errors).toEqual([]);
    const paths = [
      'src/components/3d/farForest.ts',
      'src/components/3d/gardenDetails.ts',
      'src/components/3d/temporalAA.ts',
      'public/models/sauna.glb',
      'public/models/sauna-garden.glb',
      'public/models/irradiance.bin',
      'public/models/reflection.bin',
    ];
    const baseline = process.env.FOREST_BASELINE_DIST;
    const inputHash = (p: string) =>
      createHash('sha256')
        .update(
          readFileSync(
            baseline && p === 'src/components/3d/farForest.ts' ? join(dirname(baseline), 'farForest.before.ts') : p,
          ),
        )
        .digest('hex');
    await info.attach('far-crowns', {
      contentType: 'application/json',
      body: JSON.stringify({
        run,
        baseline: !!baseline,
        forestBuild,
        browser: browser.version(),
        controls,
        captures,
        errors,
        inputs: Object.fromEntries(paths.map((p) => [p, inputHash(p)])),
      }),
    });
  });
}
