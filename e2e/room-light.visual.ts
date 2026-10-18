import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { chooseSceneSetting } from './settings-controls';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const rear = { position: [-3.2, 1.65, -2.78], target: [-3.6, 0.65, -4.5], fov: 58 };
const review = JSON.parse(readFileSync('e2e/fixtures/cycles-cameras.json', 'utf8')).cameras.find(
  (camera: { render: string }) => camera.render === '02.png',
);
for (const [run, enabled] of [
  ['before-1', false],
  ['after-1', true],
  ['after-2', true],
  ['before-2', false],
] as const) {
  test(`room light ${run}`, async ({ page, browser }, info) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    if (!enabled)
      await page.addInitScript(() => {
        const original = WebGL2RenderingContext.prototype.shaderSource;
        (window as any).roomControls = 0;
        WebGL2RenderingContext.prototype.shaderSource = function (shader, source) {
          if (/^#define SUI_ROOM_IRRADIANCE\b/m.test(source)) {
            source = source.replace(/^#define SUI_ROOM_IRRADIANCE[^\n]*/m, '#undef SUI_ROOM_IRRADIANCE');
            (window as any).roomControls++;
          }
          return original.call(this, shader, source);
        };
      });
    let view = 'seated';
    await page.route('**/sauna.scene.json', async (route) => {
      const definition = await (await route.fetch()).json();
      if (view === 'rear') definition.views.sauna = rear;
      if (view === 'review')
        definition.views.sauna = { position: review.position, target: review.target, fov: review.fov };
      await route.fulfill({ json: definition });
    });
    const captures: object[] = [];
    for (view of ['seated', 'rear', 'review']) {
      await page.goto(
        `?sound=off&view=3d&quality=standard&resolution=fixed&frameRate=full${view === 'seated' ? '' : '&camera=review'}`,
      );
      await page.getByRole('button', { name: '入室する', exact: true }).click();
      const scene = page.locator('.sauna-3d-canvas');
      await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
      await expect(scene).toHaveAttribute('data-room-irradiance-materials', '3');
      await expect(scene).toHaveAttribute('data-room-irradiance-triangles', /[1-9]\d*/);
      for (const lighting of ['day', 'evening', 'night']) {
        await chooseSceneSetting(page, '3Dの時間帯', lighting);
        await expect(scene).toHaveAttribute('data-lighting', lighting);
        await settleRenderer(page);
        const file = `${view}-${lighting}.png`;
        await scene.locator('canvas').screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
        captures.push({
          file,
          view,
          lighting,
          metrics: await scene.evaluate((el) => ({ ...(el as HTMLElement).dataset })),
        });
      }
      if (!enabled) expect(await page.evaluate(() => (window as any).roomControls)).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
    const files = [
      'src/components/3d/roomIrradiance.ts',
      'public/models/room-irradiance.json',
      'public/models/room-irradiance.bin',
      'public/models/sauna.glb',
      'public/models/irradiance.bin',
    ];
    await info.attach('room-light.json', {
      contentType: 'application/json',
      body: JSON.stringify({
        run,
        enabled,
        directory: basename(info.outputDir),
        browser: browser.version(),
        rear,
        errors,
        captures,
        inputs: Object.fromEntries(files.map((f) => [f, createHash('sha256').update(readFileSync(f)).digest('hex')])),
      }),
    });
  });
}
