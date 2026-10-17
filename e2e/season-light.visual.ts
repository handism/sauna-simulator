import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { chooseSceneSetting } from './settings-controls';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';

// Paired builds: 36 static seated views, not directional bake fidelity or motion approval.
test('capture seasonal indirect light in all stages and times', async ({ page, browser }, info) => {
  test.setTimeout(480_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('?sound=off&view=3d&quality=standard&resolution=fixed&frameRate=full');
  await page.getByRole('button', { name: '入室する', exact: true }).click();
  const scene = page.locator('.sauna-3d-canvas'),
    canvas = scene.locator('canvas');
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
  const original = await canvas.elementHandle();
  const samples = [];
  for (const [stage, next] of [
    ['sauna', '水風呂へ'],
    ['water', '外気浴へ'],
    ['totonou', null],
  ] as const) {
    await expect(scene).toHaveAttribute('data-stage', stage);
    await page.waitForTimeout(1200);
    for (const season of ['summer', 'spring', 'autumn', 'winter']) {
      await chooseSceneSetting(page, '3Dの季節', season);
      await expect(scene).toHaveAttribute('data-season', season);
      for (const lighting of ['day', 'evening', 'night']) {
        await chooseSceneSetting(page, '3Dの時間帯', lighting);
        await expect(scene).toHaveAttribute('data-lighting', lighting);
        await settleRenderer(page);
        await expect(scene).toHaveAttribute('data-pixel-ratio', '1');
        const file = `${stage}-${season}-${lighting}.png`;
        await canvas.screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
        samples.push({
          file,
          stage,
          season,
          lighting,
          metrics: await scene.evaluate((e) => ({ ...(e as HTMLElement).dataset })),
        });
      }
    }
    if (next) await page.getByRole('button', { name: next, exact: true }).click();
  }
  expect(await canvas.evaluate((e, original) => e === original, original)).toBe(true);
  expect(errors).toEqual([]);
  const hashes = Object.fromEntries(
    [
      'public/models/sauna.glb',
      'public/models/sauna-garden.glb',
      'public/models/irradiance.bin',
      'public/models/reflection.bin',
      'src/components/3d/seasonal-light.json',
      'src/components/3d/seasonalLight.ts',
      'src/components/3d/irradiance.ts',
      'src/components/3d/refraction.ts',
      'e2e/season-light.visual.ts',
    ].map((p) => [p, existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null]),
  );
  await info.attach('season-light', {
    contentType: 'application/json',
    body: JSON.stringify({ browser: browser.version(), viewport: page.viewportSize(), samples, hashes, errors }),
  });
});
