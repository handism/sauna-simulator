import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chooseSceneSetting } from './settings-controls';
import { observeGpuMemory, gpuMemory } from './gpu-memory';
import { timeFrames } from './gpu-timer';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';

// Diagnostic ABBA comparison. Deployed assets are never overwritten.
const REPEAT = Number(process.env.GARDEN_INDEX_REPEAT ?? 4);
if (!Number.isInteger(REPEAT) || REPEAT < 1) throw new Error('Invalid GARDEN_INDEX_REPEAT');
const path = process.env.QA_GARDEN_MODEL;
if (!path) throw new Error('QA_GARDEN_MODEL is required');
const original = readFileSync('public/models/sauna-garden.glb');
const candidate = readFileSync(path);
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const inputHashes = Object.fromEntries(
  [
    'public/models/sauna.glb',
    'public/models/sauna.scene.json',
    'public/models/irradiance.bin',
    'public/models/reflection.bin',
    'e2e/garden-indices.gpu.ts',
    'e2e/gpu-timer.ts',
    'e2e/gpu-memory.ts',
  ].map((path) => [path, hash(readFileSync(path))]),
);
test.use({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
for (const [index, variant] of ['original', 'candidate', 'candidate', 'original'].entries()) {
  test(`garden indices ${index} ${variant}`, async ({ page, browser }, info) => {
    test.setTimeout(300_000);
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
    await page.addInitScript(observeGpuMemory);
    await page.addInitScript(timeFrames, REPEAT);
    await page.goto('?view=3d&resolution=fixed&frameRate=full');
    await page.getByRole('button', { name: '音なしで入室する' }).click();
    const scene = page.locator('.sauna-3d-canvas');
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
    await chooseSceneSetting(page, '3Dの画質', 'standard');
    await expect(scene).toHaveAttribute('data-quality', 'standard');
    expect(await page.evaluate(() => Boolean((window as unknown as { suiTimer?: object }).suiTimer))).toBe(true);
    const rows = [];
    for (const [stage, next] of [
      ['sauna', '水風呂へ'],
      ['water', '外気浴へ'],
      ['totonou', null],
    ] as const) {
      await expect(scene).toHaveAttribute('data-stage', stage);
      await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
      for (const lighting of ['day', 'evening', 'night']) {
        await chooseSceneSetting(page, '3Dの時間帯', lighting);
        await expect(scene).toHaveAttribute('data-lighting', lighting);
        await page.waitForTimeout(2500);
        // First-use compilation excluded; timing is only for fully drawn steady frames.
        await page.evaluate(() => {
          const w = window as unknown as { suiGpuMs: number[]; suiFrameAt: number[]; suiMeasure: boolean };
          w.suiGpuMs = [];
          w.suiFrameAt = [];
          w.suiMeasure = true;
        });
        await page.waitForTimeout(4000);
        await page.evaluate(() => ((window as unknown as { suiMeasure: boolean }).suiMeasure = false));
        await page.waitForTimeout(1000);
        const times = await page.evaluate(() => (window as unknown as { suiGpuMs: number[] }).suiGpuMs);
        expect(times.length).toBeGreaterThan(10);
        const sorted = [...times].sort((a, b) => a - b);
        const frameAt = await page.evaluate(() => (window as unknown as { suiFrameAt: number[] }).suiFrameAt);
        const intervalMeanMs = (frameAt[frameAt.length - 1] - frameAt[0]) / (frameAt.length - 1) / REPEAT;
        await settleRenderer(page);
        const image = await scene.locator('canvas').screenshot({ type: 'png', style: rendererCaptureStyle });
        const name = `${stage}-${lighting}`;
        await info.attach(name, { body: image, contentType: 'image/png' });
        const contexts = (await gpuMemory(page)).filter((context) => context.connected && !context.lost);
        expect(contexts).toHaveLength(1);
        expect(contexts[0].unknownFormats).toEqual([]);
        rows.push({
          stage,
          lighting,
          frames: times.length,
          gpuMs: {
            p10: sorted[Math.floor(sorted.length * 0.1)],
            median: sorted[Math.floor(sorted.length * 0.5)],
            p90: sorted[Math.floor(sorted.length * 0.9)],
          },
          intervalMeanMs,
          imageSha256: hash(image),
          memory: contexts[0],
          metrics: await scene.evaluate((el) => ({ ...(el as HTMLElement).dataset })),
        });
      }
      await page.getByRole('button', { name: '操作を表示', exact: true }).click();
      if (next) await page.getByRole('button', { name: next, exact: true }).click();
    }
    expect(requests).toBe(1);
    expect(errors).toEqual([]);
    await info.attach('garden-indices', {
      contentType: 'application/json',
      body: JSON.stringify({
        index,
        variant,
        browser: browser.version(),
        quality: 'standard',
        repeat: REPEAT,
        inputHashes,
        dpr: 1,
        modelSha256: hash(bytes),
        modelBytes: bytes.length,
        originalSha256: hash(original),
        candidateSha256: hash(candidate),
        requests,
        errors,
        rows,
      }),
    });
  });
}
