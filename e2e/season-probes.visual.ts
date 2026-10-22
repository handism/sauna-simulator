import { expect, test } from '@playwright/test';
import { chooseSceneSetting } from './settings-controls';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';

// One run of the ABBA comparison of the seasonal rebake of the outdoor probe grids
// (seasonalProbes.ts) against the calibrated gains alone (seasonalLight.ts), in the same build: the
// `gains` runs abort the season files, so the scene keeps the gains. SEASON_PROBES_RUN labels the
// run (gains1, baked1, baked2, gains2); SEASON_PROBES_SEASONS picks the seasons (default all three).
const run = process.env.SEASON_PROBES_RUN ?? 'baked1';
const baked = run.startsWith('baked');
const seasons = (process.env.SEASON_PROBES_SEASONS ?? 'spring,autumn,winter').split(',');
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
test(`season probes ${run}`, async ({ page, browser }, info) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // The gains runs abort the season files on purpose.
    if (m.type() === 'error' && !(!baked && m.location().url.includes('/models/seasons/'))) errors.push(m.text());
  });
  const requested: string[] = [];
  await page.route('**/models/seasons/**', (route) => {
    requested.push(new URL(route.request().url()).pathname.split('/').pop()!);
    return baked ? route.continue() : route.abort();
  });
  await page.goto('?sound=off&view=3d&quality=standard&resolution=fixed&frameRate=full');
  await page.getByRole('button', { name: '入室する', exact: true }).click();
  const scene = page.locator('.sauna-3d-canvas');
  const canvas = scene.locator('canvas');
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
  // Summer ships with the scene: no season file until another season is chosen.
  expect(requested).toEqual([]);
  const captures: { file: string; metrics: Record<string, string | undefined> }[] = [];
  for (const [stage, next] of [
    ['sauna', '水風呂へ'],
    ['water', '外気浴へ'],
    ['totonou', null],
  ] as const) {
    await expect(scene).toHaveAttribute('data-stage', stage);
    await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
    for (const season of seasons) {
      await chooseSceneSetting(page, '3Dの季節', season);
      await expect(scene).toHaveAttribute('data-season', season);
      if (baked) await expect(scene).toHaveAttribute('data-season-probes', season, { timeout: 30_000 });
      for (const lighting of ['day', 'evening', 'night']) {
        await chooseSceneSetting(page, '3Dの時間帯', lighting);
        await expect(scene).toHaveAttribute('data-lighting', lighting);
        await scene.focus();
        await settleRenderer(page);
        if (!baked) await expect(scene).not.toHaveAttribute('data-season-probes', season);
        const file = `${stage}-${season}-${lighting}.png`;
        await canvas.screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
        captures.push({ file, metrics: await scene.evaluate((e) => ({ ...(e as HTMLElement).dataset })) });
      }
    }
    await chooseSceneSetting(page, '3Dの季節', 'summer');
    await expect(scene).toHaveAttribute('data-season', 'summer');
    await page.getByRole('button', { name: '操作を表示', exact: true }).click();
    if (next) await page.getByRole('button', { name: next, exact: true }).click();
  }
  // Each season's two files (json, bin) of both kinds, requested once for the visit (a failure is
  // kept too, so the gains runs do not retry).
  expect(new Set(requested).size).toBe(seasons.length * 4);
  expect(requested.length).toBe(seasons.length * 4);
  expect(errors).toEqual([]);
  await info.attach('season-probes', {
    contentType: 'application/json',
    body: JSON.stringify({ run, seasons, browser: browser.version(), requested, captures, errors }),
  });
});
