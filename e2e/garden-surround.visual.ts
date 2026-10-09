import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chooseSceneSetting } from './settings-controls';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';

// Static ABBA survey: isolate index splitting from DOM animation and TAA settling.
const candidatePath = process.env.QA_GARDEN_MODEL;
if (!candidatePath) throw new Error('QA_GARDEN_MODEL is required');
const original = readFileSync('public/models/sauna-garden.glb');
const candidate = readFileSync(candidatePath);
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const inputHashes = Object.fromEntries(
  [
    'public/models/sauna.glb',
    'public/models/sauna.scene.json',
    'public/models/irradiance.json',
    'public/models/irradiance.bin',
    'public/models/reflection.json',
    'public/models/reflection.bin',
    'e2e/garden-surround.visual.ts',
    'e2e/scene-capture.ts',
    'e2e/settings-controls.ts',
  ].map((path) => [path, hash(readFileSync(path))]),
);
test.use({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
for (const [index, variant] of ['original', 'candidate', 'candidate', 'original'].entries()) {
  test(`garden surround ${index} ${variant}`, async ({ page, browser }, info) => {
    test.setTimeout(900_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const bytes = variant === 'candidate' ? candidate : original;
    let requests = 0;
    await page.route('**/sauna-garden.glb', async (route) => {
      requests++;
      await route.fulfill({ body: bytes, contentType: 'model/gltf-binary' });
    });
    await page.goto('?view=3d&resolution=fixed&frameRate=full');
    await page.getByRole('button', { name: '音なしで入室する' }).click();
    const scene = page.locator('.sauna-3d-canvas');
    const canvas = scene.locator('canvas');
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
    await chooseSceneSetting(page, '3Dの画質', 'standard');
    await expect(scene).toHaveAttribute('data-quality', 'standard');
    const originalCanvas = await canvas.elementHandle();
    const press = async (key: string, count: number) => {
      await scene.focus();
      for (let n = 0; n < count; n++) await page.keyboard.press(key);
    };
    const rows = [];
    for (const [stage, next] of [
      ['sauna', '水風呂へ'],
      ['water', '外気浴へ'],
      ['totonou', null],
    ] as const) {
      await expect(scene).toHaveAttribute('data-stage', stage);
      await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
      await page.waitForTimeout(1200);
      for (const lighting of ['day', 'evening', 'night']) {
        await chooseSceneSetting(page, '3Dの時間帯', lighting);
        await expect(scene).toHaveAttribute('data-lighting', lighting);
        for (let heading = 0; heading < 8; heading++) {
          await press('ArrowDown', 32);
          for (const pitch of ['down', 'level', 'up']) {
            if (pitch === 'level') await press('ArrowUp', 14);
            if (pitch === 'up') await press('ArrowUp', 32);
            await scene.blur();
            await settleRenderer(page);
            const name = `${stage}-${lighting}-${heading}-${pitch}`;
            const path = info.outputPath(`${name}.png`);
            const image = await canvas.screenshot({ path, type: 'png', style: rendererCaptureStyle });
            await info.attach(name, { path, contentType: 'image/png' });
            rows.push({
              stage,
              lighting,
              heading,
              pitch,
              imageSha256: hash(image),
              metrics: await scene.evaluate((element) => ({ ...(element as HTMLElement).dataset })),
            });
          }
          await press('ArrowRight', 10);
        }
        await press('ArrowLeft', 80);
        process.stderr.write(`garden surround ${index} ${variant}: ${stage}/${lighting} complete\n`);
      }
      expect(await originalCanvas!.evaluate((el) => el === document.querySelector('.sauna-3d-canvas canvas'))).toBe(
        true,
      );
      await page.getByRole('button', { name: '操作を表示', exact: true }).click();
      if (next) await page.getByRole('button', { name: next, exact: true }).click();
    }
    expect(requests).toBe(1);
    expect(errors).toEqual([]);
    await info.attach('garden-surround', {
      contentType: 'application/json',
      body: JSON.stringify({
        index,
        variant,
        browser: browser.version(),
        quality: 'standard',
        dpr: 1,
        viewport: page.viewportSize(),
        reducedMotion: true,
        inputHashes,
        originalSha256: hash(original),
        candidateSha256: hash(candidate),
        modelSha256: hash(bytes),
        requests,
        errors,
        rows,
      }),
    });
  });
}
