import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { rendererCaptureStyle } from './scene-capture';

type Camera = { render: string; camera: string; lighting: string; position: number[]; target: number[]; fov: number };
// Written by scripts/blender_camera_reference.py from the source blend.
const reference: { input_sha256: string; cameras: Camera[] } = JSON.parse(
  readFileSync(new URL('./fixtures/cycles-cameras.json', import.meta.url), 'utf8'),
);
const byRender = (render: string) => reference.cameras.find((camera) => camera.render === render)!;
// Each pass places Cycles cameras into the three stage views of the real scene definition.
// Lighting is chosen manually, so a stage only changes steam and water, not the sky.
const passes: Record<'sauna' | 'water' | 'totonou', Camera>[] = [
  { sauna: byRender('02.png'), water: byRender('03.png'), totonou: byRender('07.png') },
  { sauna: byRender('01.png'), water: byRender('04.png'), totonou: byRender('05.png') },
];

test.use({ viewport: { width: 1200, height: 800 } });

// Review artifacts for side-by-side comparison with blender/renders, not an equivalence test.
test('capture the Cycles review cameras in the browser scene', async ({ page, browser }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const samples: object[] = [];
  for (const views of passes) {
    await page.route('**/sauna.scene.json', async (route) => {
      const definition = await (await route.fetch()).json();
      for (const [stage, camera] of Object.entries(views))
        definition.views[stage] = { position: camera.position, target: camera.target, fov: camera.fov };
      await route.fulfill({ json: definition });
    });
    await page.goto('?view=3d');
    await page.getByRole('button', { name: '静かに入室する' }).click();
    const scene = page.locator('.sauna-3d-canvas');
    const canvas = scene.locator('canvas');
    await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 20_000 });
    await page.getByLabel('3Dの画質').selectOption('standard');
    const stages = [
      ['sauna', '限界.. 水風呂へ 💧'],
      ['water', '外気浴へ 🍃'],
      ['totonou', 'もう一度サウナへ 🔄'],
    ] as const;
    for (const [stage, next] of stages) {
      await expect(scene).toHaveAttribute('data-stage', stage);
      await page.getByRole('button', { name: 'UI非表示', exact: true }).click();
      await page.waitForTimeout(1200);
      for (const lighting of ['day', 'evening']) {
        await page.getByLabel('3Dの時間帯').selectOption(lighting);
        await expect(scene).toHaveAttribute('data-lighting', lighting);
        const camera = views[stage];
        const file = `cycles-${camera.render.replace('.png', '')}-${lighting}.jpg`;
        await canvas.screenshot({
          path: info.outputPath(file),
          type: 'jpeg',
          quality: 90,
          style: rendererCaptureStyle,
        });
        // 06 is camera 01 in the blue-hour scene; pair captures with the render of the same light.
        const render =
          reference.cameras.find((other) => other.camera === camera.camera && other.lighting === lighting)?.render ??
          null;
        samples.push({
          file,
          stage,
          lighting,
          render,
          camera: camera.camera,
          metrics: await scene.evaluate((element) => ({ ...(element as HTMLElement).dataset })),
        });
      }
      await page.getByRole('button', { name: 'UI表示', exact: true }).click();
      await page.getByRole('button', { name: next, exact: true }).click();
    }
    await page.unroute('**/sauna.scene.json');
  }
  expect(errors).toEqual([]);
  const hashes = Object.fromEntries(
    await Promise.all(
      ['sauna.glb', 'sauna.scene.json', 'irradiance.json', 'irradiance.bin'].map(async (file) => [
        file,
        createHash('sha256')
          .update(await readFile(`public/models/${file}`))
          .digest('hex'),
      ]),
    ),
  );
  await info.attach('cycles-compare', {
    contentType: 'application/json',
    body: JSON.stringify(
      {
        browser: browser.version(),
        viewport: page.viewportSize(),
        deviceScaleFactor: 1,
        quality: 'standard',
        reducedMotion: true,
        captureStyle: rendererCaptureStyle,
        stageOverlays: false,
        muted: true,
        cameraReference: reference.input_sha256,
        hashes,
        errors,
        samples,
        note: 'Same camera position, direction and vertical FOV as the Cycles renders. Lighting, exposure and materials differ; manual review only.',
      },
      null,
      2,
    ),
  });
});
