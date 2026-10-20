import { expect, test } from '@playwright/test';
import { chooseSceneSetting } from './settings-controls';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';
import { verifyForestBuild } from './forest-build';

// One run of a before/after (ABBA) still comparison of the far forest's leaf masses. The run label
// comes from FOREST_RUN; FOREST_BASELINE_DIST serves the real pre-change build for the before runs.
const run = process.env.FOREST_RUN ?? 'after1';
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
test(`far forest leaf masses ${run}`, async ({ page, browser }, info) => {
  test.setTimeout(300_000);
  expect(!!process.env.FOREST_BASELINE_DIST).toBe(run.startsWith('before'));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('?sound=off&view=3d&quality=standard&resolution=fixed&frameRate=full');
  await page.getByRole('button', { name: '入室する', exact: true }).click();
  const scene = page.locator('.sauna-3d-canvas');
  const canvas = scene.locator('canvas');
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
  const forestBuild = await verifyForestBuild(page);
  const captures: { stage: string; file: string; metrics: Record<string, string | undefined> }[] = [];
  const capture = async (file: string, stage: string) => {
    await settleRenderer(page);
    await canvas.screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
    captures.push({ stage, file, metrics: await scene.evaluate((e) => ({ ...(e as HTMLElement).dataset })) });
  };
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
    let heading = 0;
    for (const target of [0, 20, 60]) {
      // Selecting a time of day focuses the settings menu: return input to the look surface.
      await scene.focus();
      for (let i = heading; i < target; i++) await page.keyboard.press('ArrowRight');
      heading = target;
      for (const lighting of ['day', 'evening', 'night']) {
        await chooseSceneSetting(page, '3Dの時間帯', lighting);
        await expect(scene).toHaveAttribute('data-lighting', lighting);
        await capture(`${stage}-${lighting}-${target}.png`, stage);
      }
    }
    if (stage === 'totonou') {
      await chooseSceneSetting(page, '3Dの時間帯', 'day');
      for (const season of ['spring', 'autumn', 'winter']) {
        await chooseSceneSetting(page, '3Dの季節', season);
        await expect(scene).toHaveAttribute('data-season', season);
        await capture(`${stage}-${season}-day-${heading}.png`, stage);
      }
      await chooseSceneSetting(page, '3Dの季節', 'summer');
    }
    await page.getByRole('button', { name: '操作を表示', exact: true }).click();
    if (next) await page.getByRole('button', { name: next, exact: true }).click();
  }
  expect(errors).toEqual([]);
  await info.attach('forest-leaf-masses', {
    contentType: 'application/json',
    body: JSON.stringify({ run, forestBuild, browser: browser.version(), captures, errors }),
  });
});
