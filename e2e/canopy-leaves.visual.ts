import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chooseSceneSetting } from './settings-controls';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';

const baseline = process.env.CANOPY_BASELINE_DIST;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
// Pitch from the lower limit (−0.85 rad) in 0.06 rad arrow steps: about 0.35 rad and the upper limit.
const VIEWS = [
  ['mid', 20],
  ['up', 30],
] as const;
for (const run of baseline ? ['before1', 'after1', 'after2', 'before2'] : ['after1']) {
  test(`canopy leaves ${run}`, async ({ page, browser }, info) => {
    test.setTimeout(300_000);
    const dist = run.startsWith('before') ? baseline! : 'dist';
    const errors: string[] = [];
    const loaded: Record<string, string> = {};
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    // Serve each complete build, including its HTML and dynamic chunk names.
    await page.route('**/sauna-simulator/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname.replace('/sauna-simulator/', '');
      const relative = pathname || 'index.html';
      const path = join(dist, relative);
      if (!existsSync(path)) return route.continue();
      const body = readFileSync(path);
      if (relative.endsWith('.js')) loaded[relative] = sha(body);
      const contentType = relative.endsWith('.js')
        ? 'application/javascript'
        : relative.endsWith('.html')
          ? 'text/html'
          : relative.endsWith('.css')
            ? 'text/css'
            : relative.endsWith('.json')
              ? 'application/json'
              : 'application/octet-stream';
      await route.fulfill({ body, contentType });
    });
    await page.goto('?view=3d&quality=standard&resolution=fixed&frameRate=full&sound=off');
    await chooseSceneSetting(page, '3Dの時間帯', 'day');
    await page.getByRole('button', { name: '入室する', exact: true }).click();
    const scene = page.locator('.sauna-3d-canvas');
    const canvas = scene.locator('canvas');
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 40_000 });
    const bundle = readdirSync(join(dist, 'assets')).find((f) => /^SaunaScene-.*\.js$/.test(f))!;
    expect(loaded[`assets/${bundle}`]).toBe(sha(readFileSync(join(dist, 'assets', bundle))));
    const captures: { file: string; metrics: Record<string, string | undefined> }[] = [];
    const capture = async (file: string) => {
      await settleRenderer(page);
      await canvas.screenshot({
        path: info.outputPath(file),
        style: rendererCaptureStyle + '\n.sauna-3d-canvas { outline: none !important; }',
      });
      captures.push({ file, metrics: await scene.evaluate((e) => ({ ...(e as HTMLElement).dataset })) });
    };
    const look = async (steps: number) => {
      await scene.focus();
      for (let i = 0; i < 32; i++) await page.keyboard.press('ArrowDown');
      for (let i = 0; i < steps; i++) await page.keyboard.press('ArrowUp');
    };
    await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
    for (const [stage, next] of [
      ['water', '外気浴へ'],
      ['totonou', null],
    ] as const) {
      await expect(scene).toHaveAttribute('data-stage', stage);
      await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
      for (const light of ['day', 'evening', 'night']) {
        await chooseSceneSetting(page, '3Dの時間帯', light);
        for (const [view, steps] of VIEWS) {
          await look(steps);
          await capture(`${stage}-${light}-${view}.png`);
        }
      }
      await chooseSceneSetting(page, '3Dの時間帯', 'day');
      if (stage === 'totonou') {
        await look(VIEWS[1][1]);
        for (const season of ['spring', 'autumn']) {
          await chooseSceneSetting(page, '3Dの季節', season);
          await capture(`${stage}-${season}-up.png`);
        }
        await chooseSceneSetting(page, '3Dの季節', 'summer');
      }
      await page.getByRole('button', { name: '操作を表示', exact: true }).click();
      if (next) await page.getByRole('button', { name: next, exact: true }).click();
    }
    expect(errors).toEqual([]);
    await info.attach('canopy-leaves', {
      contentType: 'application/json',
      body: JSON.stringify({ run, browser: browser.version(), bundle, loaded, captures, errors }),
    });
  });
}
