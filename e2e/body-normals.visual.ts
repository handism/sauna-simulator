import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { useModelCandidate } from './model-candidate';
import { chooseSceneSetting } from './settings-controls';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';

const quality = process.env.CAPTURE_QUALITY ?? 'standard';
const deviceScaleFactor = Number(process.env.CAPTURE_DPR ?? 1.5);
test.use({ viewport: { width: 1200, height: 800 }, deviceScaleFactor });

// The non-uniformly scaled condensation bead has the largest world-normal error.
// Isolate it at a closer view than the normal seated cameras, without changing geometry.
test('capture condensation normals at close range', async ({ page, browser }, info) => {
  const candidate = await useModelCandidate(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const bytes = readFileSync('public/models/sauna.glb');
  const model = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const bead = model.nodes.find((node: { name?: string }) => node.name === 'Glass condensation bead');
  expect(bead).toBeTruthy();
  const [x, y, z] = bead.translation as number[];
  const camera = { position: [x - 0.12, y, z - 0.38], target: [x, y, z], fov: 38 };
  await page.route('**/sauna.scene.json', async (route) => {
    const definition = await (await route.fetch()).json();
    definition.views.sauna = camera;
    await route.fulfill({ json: definition });
  });
  await page.goto('?view=3d&resolution=fixed&frameRate=full');
  await page.getByRole('button', { name: '音なしで入室する' }).click();
  const scene = page.locator('.sauna-3d-canvas');
  await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 20_000 });
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 20_000 });
  await chooseSceneSetting(page, '3Dの画質', quality);
  await expect(scene).toHaveAttribute('data-quality', quality);
  await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
  await page.waitForTimeout(1200);
  const samples = [];
  for (const lighting of ['day', 'evening', 'night']) {
    await chooseSceneSetting(page, '3Dの時間帯', lighting);
    await expect(scene).toHaveAttribute('data-lighting', lighting);
    await settleRenderer(page);
    const file = `condensation-${lighting}.png`;
    await scene.locator('canvas').screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
    samples.push({ file, lighting, metrics: await scene.evaluate((e) => ({ ...(e as HTMLElement).dataset })) });
  }
  expect(errors).toEqual([]);
  if (candidate) expect(candidate.requests()).toBe(1);
  await info.attach('body-normals', {
    contentType: 'application/json',
    body: JSON.stringify(
      {
        browser: browser.version(),
        camera,
        quality,
        deviceScaleFactor,
        sourceSha256: createHash('sha256').update(bytes).digest('hex'),
        bodyCandidate: candidate && {
          sha256: candidate.sha256,
          bytes: candidate.bytes,
          requests: candidate.requests(),
        },
        errors,
        samples,
      },
      null,
      2,
    ),
  });
});
