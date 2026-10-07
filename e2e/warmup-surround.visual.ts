import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { chooseSceneSetting } from './settings-controls';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';

// Compare the shipped optional warmup with normal preparation, including replay noise.
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const inputHashes = Object.fromEntries(
  [
    'public/models/sauna.glb',
    'public/models/sauna.scene.json',
    'public/models/irradiance.json',
    'public/models/irradiance.bin',
    'public/models/reflection.json',
    'public/models/reflection.bin',
    'e2e/warmup-surround.visual.ts',
    'public/models/sauna-garden.glb',
    ...readdirSync('src/components/3d')
      .filter((name) => /\.tsx?$/.test(name))
      .map((name) => `src/components/3d/${name}`),
    'src/components/SceneMode.tsx',
    'playwright.visual.config.ts',
    'playwright.config.ts',
    'e2e/scene-capture.ts',
    'e2e/settings-controls.ts',
  ].map((path) => [path, hash(readFileSync(path))]),
);
test.use({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
for (const [index, variant] of ['normal', 'split', 'split', 'normal'].entries()) {
  test(`warmup surround ${index} ${variant}`, async ({ page, browser }, info) => {
    test.setTimeout(900_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    let requests = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/sauna-garden.glb')) requests++;
    });
    await page.goto(`?view=3d&resolution=fixed&frameRate=full&warmup=${variant === 'split' ? 'split' : 'off'}`);
    await page.getByRole('button', { name: '音なしで入室する' }).click();
    const scene = page.locator('.sauna-3d-canvas');
    const canvas = scene.locator('canvas');
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
    await chooseSceneSetting(page, '3Dの画質', 'standard');
    await expect(scene).toHaveAttribute('data-quality', 'standard');
    if (variant === 'split') {
      await expect(scene).toHaveAttribute('data-warmup', 'split');
      await expect(scene).toHaveAttribute('data-warming', 'none');
      await expect(scene).toHaveAttribute('data-warmup-undrawn', '0');
      await expect(scene).toHaveAttribute('data-garden-warmup-undrawn', '0');
    }
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
      await page.getByRole('button', { name: 'UI非表示', exact: true }).click();
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
        process.stderr.write(`warmup surround ${index} ${variant}: ${stage}/${lighting} complete\n`);
      }
      expect(await originalCanvas!.evaluate((el) => el === document.querySelector('.sauna-3d-canvas canvas'))).toBe(
        true,
      );
      await page.getByRole('button', { name: 'UI表示', exact: true }).click();
      if (next) await page.getByRole('button', { name: next, exact: true }).click();
    }
    expect(requests).toBe(1);
    expect(errors).toEqual([]);
    await info.attach('warmup-surround', {
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
        requests,
        errors,
        rows,
      }),
    });
  });
}
