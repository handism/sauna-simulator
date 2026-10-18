import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chooseSceneSetting } from './settings-controls';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';

const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const original = readFileSync(process.env.QA_LOYLY_BASELINE ?? 'public/models/sauna.glb');
const candidate = readFileSync(process.env.QA_LOYLY_CANDIDATE ?? 'public/models/sauna.glb');
const runs = process.env.QA_LOYLY_BASELINE ? ['before-1', 'after-1', 'after-2', 'before-2'] : ['after-1'];
const views = [
  { name: 'seated', width: 1280, height: 800 },
  {
    name: 'detail',
    width: 1280,
    height: 800,
    camera: { position: [-2.85, 1.15, -2.52], target: [-1.72, 0.61, -1.48], fov: 52 },
  },
  { name: 'portrait', width: 390, height: 844 },
  { name: 'wide', width: 844, height: 390 },
];

for (const run of runs) {
  test(`loyly props ${run}`, async ({ page, browser }, info) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    const body = run.startsWith('before') ? original : candidate;
    await page.route('**/sauna.glb', (route) => route.fulfill({ body, contentType: 'model/gltf-binary' }));
    const captures = [];
    for (const view of views) {
      await page.setViewportSize({ width: view.width, height: view.height });
      await page.unroute('**/sauna.scene.json');
      if (view.camera)
        await page.route('**/sauna.scene.json', async (route) => {
          const definition = await (await route.fetch()).json();
          definition.views.sauna = view.camera;
          await route.fulfill({ json: definition });
        });
      await page.goto(
        `?sound=off&view=3d&quality=standard&resolution=fixed&frameRate=full${view.camera ? '&camera=review' : ''}`,
      );
      await page.getByRole('button', { name: '入室する', exact: true }).click();
      const scene = page.locator('.sauna-3d-canvas');
      await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
      for (const lighting of ['day', 'evening', 'night']) {
        await chooseSceneSetting(page, '3Dの時間帯', lighting);
        await expect(scene).toHaveAttribute('data-lighting', lighting);
        await settleRenderer(page);
        const file = `${view.name}-${lighting}.png`;
        const image = await scene
          .locator('canvas')
          .screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
        captures.push({
          file,
          view: view.name,
          lighting,
          sha256: hash(image),
          metrics: await scene.evaluate((el) => ({ ...(el as HTMLElement).dataset })),
        });
      }
    }
    expect(errors).toEqual([]);
    await info.attach('loyly-props', {
      contentType: 'application/json',
      body: JSON.stringify({
        run,
        browser: browser.version(),
        views,
        errors,
        captures,
        modelSha256: hash(body),
        modelBytes: body.length,
        inputs: Object.fromEntries(
          [
            'scripts/refine_loyly_props.py',
            'scripts/export_web_glb.py',
            'public/models/sauna-garden.glb',
            'public/models/irradiance.bin',
            'public/models/reflection.bin',
          ].map((f) => [f, hash(readFileSync(f))]),
        ),
      }),
    });
  });
}
