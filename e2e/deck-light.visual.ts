import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { chooseSceneSetting } from './settings-controls';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';

test.use({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
const fixture = JSON.parse(readFileSync('e2e/fixtures/cycles-cameras.json', 'utf8'));
const camera = fixture.cameras.find((c: { render: string }) => c.render === '07.png');

// Same final build, ABBA. The control disables only the receiver shader define;
// the model, texture allocation and separated triangles are identical.
for (const [run, enabled] of [
  ['before-1', false],
  ['after-1', true],
  ['after-2', true],
  ['before-2', false],
] as const) {
  test(`deck light ${run}`, async ({ page, browser }, info) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    if (!enabled)
      await page.addInitScript(() => {
        const original = WebGL2RenderingContext.prototype.shaderSource;
        (window as unknown as { deckControls: number }).deckControls = 0;
        WebGL2RenderingContext.prototype.shaderSource = function (shader, source) {
          if (/^#define SUI_DECK_IRRADIANCE\b/m.test(source)) {
            source = source.replace(/^#define SUI_DECK_IRRADIANCE[^\n]*/m, '#undef SUI_DECK_IRRADIANCE');
            (window as unknown as { deckControls: number }).deckControls++;
          }
          return original.call(this, shader, source);
        };
      });
    await page.route('**/sauna.scene.json', async (route) => {
      const definition = await (await route.fetch()).json();
      definition.views.totonou = { position: camera.position, target: camera.target, fov: camera.fov };
      await route.fulfill({ json: definition });
    });
    await page.goto('?sound=off&camera=review&quality=standard&view=3d&frameRate=full&resolution=fixed');
    await page.getByRole('button', { name: '入室する', exact: true }).click();
    const scene = page.locator('.sauna-3d-canvas');
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
    await expect(scene).toHaveAttribute('data-deck-irradiance-materials', '1');
    await expect(scene).toHaveAttribute('data-deck-irradiance-triangles', /[1-9]\d*/);
    const captures: object[] = [];
    for (const [stage, next] of [
      ['sauna', '水風呂へ'],
      ['water', '外気浴へ'],
      ['totonou', 'もう一度サウナへ'],
    ] as const) {
      await expect(scene).toHaveAttribute('data-stage', stage);
      for (const lighting of ['day', 'evening', 'night']) {
        await chooseSceneSetting(page, '3Dの時間帯', lighting);
        await expect(scene).toHaveAttribute('data-lighting', lighting);
        await settleRenderer(page);
        const file = `${stage}-${lighting}.png`;
        await scene.locator('canvas').screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
        captures.push({
          file,
          stage,
          lighting,
          metrics: await scene.evaluate((el) => ({ ...(el as HTMLElement).dataset })),
        });
      }
      if (stage !== 'totonou') await page.getByRole('button', { name: next, exact: true }).click();
    }
    if (!enabled)
      expect(await page.evaluate(() => (window as unknown as { deckControls: number }).deckControls)).toBeGreaterThan(
        0,
      );
    expect(errors).toEqual([]);
    const files = [
      'src/components/3d/deckIrradiance.ts',
      'public/models/deck-irradiance.bin',
      'public/models/deck-irradiance.json',
      'public/models/sauna.glb',
      'public/models/irradiance.bin',
    ];
    await info.attach('deck-light.json', {
      contentType: 'application/json',
      body: JSON.stringify({
        run,
        directory: basename(info.outputDir),
        enabled,
        browser: browser.version(),
        captures,
        inputs: Object.fromEntries(
          files.map((file) => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]),
        ),
      }),
    });
  });
}
