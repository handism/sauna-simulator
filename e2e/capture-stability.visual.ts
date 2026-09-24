import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rendererCaptureStyle } from './scene-capture';

const reference = JSON.parse(readFileSync(new URL('./fixtures/cycles-cameras.json', import.meta.url), 'utf8'));
const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
// Across page loads a few isolated pixels on textured surfaces can differ (also at the low
// quality without shadows and before the current lighting); the cause is not identified.
// Within a load the renderer output must stay identical.
const RELOAD_CHANGED_SHARE = 1e-4;
// Decodes both PNGs in the browser and counts the pixels whose RGBA differs.
async function pixelDifference(page: Page, a: Buffer, b: Buffer) {
  return page.evaluate(
    async ([first, second]) => {
      const pixels = async (base64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const [x, y] = await Promise.all([pixels(first), pixels(second)]);
      let changed = 0,
        max = 0;
      for (let i = 0; i < x.length; i += 4) {
        const d = Math.max(
          Math.abs(x[i] - y[i]),
          Math.abs(x[i + 1] - y[i + 1]),
          Math.abs(x[i + 2] - y[i + 2]),
          Math.abs(x[i + 3] - y[i + 3]),
        );
        if (d) changed++;
        max = Math.max(max, d);
      }
      return { sameSize: x.length === y.length, changedShare: changed / (x.length / 4), maxDifference: max };
    },
    [a.toString('base64'), b.toString('base64')],
  );
}
test.use({ viewport: { width: 1200, height: 800 } });

test('water renderer captures exclude the animated DOM glow and nearly repeat across reloads', async ({
  page,
  browser,
}, info) => {
  const samples: object[] = [];
  const previous = new Map<string, Buffer>();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (let run = 0; run < 2; run++) {
    for (const render of ['03.png', '04.png']) {
      const camera = reference.cameras.find((entry: { render: string }) => entry.render === render);
      await page.route('**/sauna.scene.json', async (route) => {
        const definition = await (await route.fetch()).json();
        definition.views.water = { position: camera.position, target: camera.target, fov: camera.fov };
        await route.fulfill({ json: definition });
      });
      await page.goto('?view=3d');
      await page.getByRole('button', { name: '静かに入室する' }).click();
      const scene = page.locator('.sauna-3d-canvas');
      const canvas = scene.locator('canvas');
      await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 20_000 });
      await page.getByLabel('3Dの画質').selectOption('standard');
      await page.getByRole('button', { name: '限界.. 水風呂へ 💧', exact: true }).click();
      await expect(scene).toHaveAttribute('data-stage', 'water');
      await page.getByRole('button', { name: 'UI非表示', exact: true }).click();
      await page.waitForTimeout(1200);
      // Pin two phases of the real glow keyframes without changing WebGL time.
      await page.addStyleTag({
        content: '.cooling-glow { animation-duration: 1s !important; animation-play-state: paused !important; }',
      });
      for (const lighting of ['day', 'evening']) {
        await page.getByLabel('3Dの時間帯').selectOption(lighting);
        await expect(scene).toHaveAttribute('data-lighting', lighting);
        const raw: string[] = [];
        const clean: string[] = [];
        let renderer: Buffer = Buffer.alloc(0);
        for (const phase of [0, 500]) {
          await page.locator('.cooling-glow').evaluate((element, time) => {
            for (const animation of element.getAnimations()) animation.currentTime = time;
          }, phase);
          const prefix = `${render.slice(0, 2)}-${lighting}-${run}-${phase}`;
          raw.push(hash(await canvas.screenshot({ path: info.outputPath(`${prefix}-overlay.png`) })));
          renderer = await canvas.screenshot({
            path: info.outputPath(`${prefix}-renderer.png`),
            style: rendererCaptureStyle,
          });
          clean.push(hash(renderer));
        }
        expect(raw[0]).not.toBe(raw[1]);
        expect(clean[0]).toBe(clean[1]);
        const key = `${render}-${lighting}`;
        const earlier = previous.get(key);
        const reload = earlier && (await pixelDifference(page, earlier, renderer));
        if (reload) {
          expect(reload.sameSize).toBe(true);
          expect(reload.changedShare).toBeLessThanOrEqual(RELOAD_CHANGED_SHARE);
        }
        previous.set(key, renderer);
        samples.push({ render, lighting, run, raw, clean, reload });
      }
      await page.unroute('**/sauna.scene.json');
    }
  }
  expect(errors).toEqual([]);
  await info.attach('capture-stability', {
    contentType: 'application/json',
    body: JSON.stringify(
      {
        browser: browser.version(),
        viewport: page.viewportSize(),
        reducedMotion: true,
        captureStyle: rendererCaptureStyle,
        samples,
        errors,
      },
      null,
      2,
    ),
  });
});
