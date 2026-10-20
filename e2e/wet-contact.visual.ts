import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chooseSceneSetting } from './settings-controls';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';

// The rain's reflections on the wet deck and stones (rainWetness.ts, the deck's mirror) and the contact
// shadows of the sauna's stove and pail (contactShadows.ts), before and after: WET_BASELINE_DIST is the
// earlier dist, served with its own HTML and chunks like ground-foliage.visual.ts. Standard quality,
// DPR 1, fixed resolution and reduced motion (the drops hold still). Still images, not the motion.
const baseline = process.env.WET_BASELINE_DIST;
const quick = process.env.WET_QUICK === '1';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const style = rendererCaptureStyle + '\n.sauna-3d-canvas { outline: none !important; }';
for (const run of baseline ? ['before1', 'after1', 'after2', 'before2'] : ['after1']) {
  test(`wet deck and contact shadows ${run}`, async ({ page, browser }, info) => {
    test.setTimeout(420_000);
    const dist = run.startsWith('before') ? baseline! : 'dist';
    const errors: string[] = [];
    const loaded: Record<string, string> = {};
    page.on('pageerror', (e) => errors.push(e.message));
    const warnings: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
      if (m.type() === 'warning') warnings.push(m.text());
    });
    // The scene turns a link failure into the 2D fallback without its log; report the log.
    await page.addInitScript(() => {
      const proto = WebGL2RenderingContext.prototype;
      const shaderLog = proto.getShaderInfoLog;
      proto.getShaderInfoLog = function (shader) {
        const log = shaderLog.call(this, shader);
        if (log && /error/i.test(log)) console.error(`shader: ${log}`);
        return log;
      };
      const programLog = proto.getProgramInfoLog;
      proto.getProgramInfoLog = function (program) {
        const log = programLog.call(this, program);
        if (log) console.error(`program: ${log}`);
        return log;
      };
    });
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
    await expect(scene)
      .toHaveAttribute('data-garden', 'ready', { timeout: 40_000 })
      .catch((error: Error) => {
        throw Error(`${error.message}\n${[...errors, ...warnings].join('\n')}`);
      });
    const bundle = readdirSync(join(dist, 'assets')).find((f) => /^SaunaScene-.*\.js$/.test(f))!;
    expect(loaded[`assets/${bundle}`]).toBe(sha(readFileSync(join(dist, 'assets', bundle))));
    const captures: { file: string; metrics: Record<string, string | undefined> }[] = [];
    const capture = async (file: string) => {
      await settleRenderer(page);
      await canvas.screenshot({ path: info.outputPath(file), style });
      captures.push({ file, metrics: await scene.evaluate((e) => ({ ...(e as HTMLElement).dataset })) });
    };
    const look = async (key: string, times: number) => {
      await scene.focus();
      for (let i = 0; i < times; i++) await page.keyboard.press(key);
    };
    for (const [stage, next] of [
      ['sauna', '水風呂へ'],
      ['water', '外気浴へ'],
      ['totonou', null],
    ] as const) {
      await expect(scene).toHaveAttribute('data-stage', stage);
      if (!quick || stage !== 'water') {
        await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
        for (const light of quick ? ['day', 'night'] : ['day', 'evening', 'night']) {
          await chooseSceneSetting(page, '3Dの時間帯', light);
          for (const weather of stage === 'sauna' ? ['clear', 'rain'] : ['rain']) {
            await chooseSceneSetting(page, '天気', weather);
            await expect(scene).toHaveAttribute('data-rain', weather === 'rain' ? '1.000' : '0.000');
            await capture(`${stage}-${light}-${weather}.png`);
            if (stage === 'sauna' && weather === 'clear') {
              // Down at the stove's and the pail's feet.
              await look('ArrowDown', 6);
              await capture(`${stage}-${light}-floor.png`);
              await look('ArrowUp', 6);
            }
            if (stage === 'totonou') {
              // Down at the deck, and across it to the right.
              await look('ArrowDown', 4);
              await capture(`${stage}-${light}-${weather}-deck.png`);
              await look('ArrowRight', 12);
              await capture(`${stage}-${light}-${weather}-side.png`);
              await look('ArrowLeft', 12);
              await look('ArrowUp', 4);
            }
          }
        }
        await chooseSceneSetting(page, '天気', 'clear');
        await page.getByRole('button', { name: '操作を表示', exact: true }).click();
      }
      if (next) await page.getByRole('button', { name: next, exact: true }).click();
    }
    expect(errors).toEqual([]);
    await info.attach('wet-contact', {
      contentType: 'application/json',
      body: JSON.stringify({ run, browser: browser.version(), bundle, loaded, captures, errors }),
    });
  });
}
