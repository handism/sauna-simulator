import { expect, test } from '@playwright/test';
import { chooseSceneSetting } from './settings-controls';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';
import { omitForestAir } from './forest-air-controls';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Aerial perspective (aerialPerspective.ts): the same build with the air removed in the browser
// (before) and kept (after), alternated. FOREST_AIR_QUICK=1 takes the water and the garden views, once each.
const quick = process.env.FOREST_AIR_QUICK === '1';
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
// With FOREST_BASELINE_DIST (playwright.forest.config.ts) the pre-change bundle is served and taken as is.
const baseline = !!process.env.FOREST_BASELINE_DIST;
const runs = baseline ? ['baseline'] : quick ? ['before1', 'after1'] : ['before1', 'after1', 'after2', 'before2'];
for (const run of runs) {
  test(`forest air ${run}`, async ({ page, browser }, info) => {
    test.setTimeout(420_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    if (run.startsWith('before')) await page.addInitScript(omitForestAir);
    await page.goto('?sound=off&view=3d&quality=standard&resolution=fixed&frameRate=full');
    await page.getByRole('button', { name: '入室する', exact: true }).click();
    const scene = page.locator('.sauna-3d-canvas');
    const canvas = scene.locator('canvas');
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
    const captures: Record<string, unknown>[] = [];
    const shoot = async (file: string, extra: Record<string, unknown>) => {
      await settleRenderer(page);
      await canvas.screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
      captures.push({ file, ...extra, metrics: await scene.evaluate((e) => ({ ...(e as HTMLElement).dataset })) });
    };
    for (const [stage, next] of [
      ['sauna', '水風呂へ'],
      ['water', '外気浴へ'],
      ['totonou', null],
    ] as const) {
      await expect(scene).toHaveAttribute('data-stage', stage);
      if (!quick || stage !== 'sauna') {
        await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
        await scene.focus();
        for (let i = 0; i < 32; i++) await page.keyboard.press('ArrowDown');
        for (let i = 0; i < 14; i++) await page.keyboard.press('ArrowUp');
        const headings = quick ? [0, 40] : [0, 40, 100];
        let heading = 0;
        for (const target of headings) {
          await scene.focus();
          await expect(scene).toBeFocused();
          for (let i = heading; i < target; i++) await page.keyboard.press('ArrowRight');
          heading = target;
          for (const lighting of ['day', 'evening', 'night']) {
            await chooseSceneSetting(page, '3Dの時間帯', lighting);
            await expect(scene).toHaveAttribute('data-lighting', lighting);
            await shoot(`${stage}-${lighting}-${target}.png`, { stage, lighting, heading: target });
          }
        }
        if (stage === 'totonou') {
          await scene.focus();
          for (let i = 0; i < heading; i++) await page.keyboard.press('ArrowLeft');
          await chooseSceneSetting(page, '3Dの時間帯', 'day');
          for (const season of quick ? [] : ['autumn', 'winter']) {
            await chooseSceneSetting(page, '3Dの季節', season);
            await expect(scene).toHaveAttribute('data-season', season);
            await shoot(`${stage}-${season}-day-0.png`, { stage, lighting: 'day', heading: 0, season });
          }
          if (!quick) {
            await chooseSceneSetting(page, '3Dの季節', 'summer');
            await chooseSceneSetting(page, '天気', 'rain');
            await expect(scene).toHaveAttribute('data-weather', 'rain');
            await shoot(`${stage}-rain-day-0.png`, { stage, lighting: 'day', heading: 0, weather: 'rain' });
          }
        }
        await page.getByRole('button', { name: '操作を表示', exact: true }).click();
      }
      if (next) await page.getByRole('button', { name: next, exact: true }).click();
    }
    const controls = await page.evaluate(() => (window as any).forestAirControls ?? 0);
    if (!baseline) expect(controls > 0).toBe(run.startsWith('before'));
    expect(errors).toEqual([]);
    const paths = [
      'src/components/3d/aerialPerspective.ts',
      'src/components/3d/farForest.ts',
      'src/components/3d/gardenDetails.ts',
      'public/models/sauna.glb',
      'public/models/sauna-garden.glb',
    ];
    await info.attach('forest-air', {
      contentType: 'application/json',
      body: JSON.stringify({
        run,
        baseline,
        browser: browser.version(),
        controls,
        captures,
        errors,
        inputs: Object.fromEntries(paths.map((p) => [p, createHash('sha256').update(readFileSync(p)).digest('hex')])),
      }),
    });
  });
}
