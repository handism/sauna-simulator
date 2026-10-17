import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chooseSceneSetting } from './settings-controls';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';
import { installRefractionClock, type RefractionClock } from './refraction-frame-control';

test('capture bounded water refraction with a shared held frame clock', async ({ page, browser }, info) => {
  test.setTimeout(480_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript(installRefractionClock);
  await page.goto('?sound=off&view=3d&quality=standard&resolution=fixed&frameRate=full');
  await page.getByRole('button', { name: '入室する', exact: true }).click();
  const scene = page.locator('.sauna-3d-canvas'),
    canvas = scene.locator('canvas');
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
  await expect(scene).toHaveAttribute('data-stage', 'water');
  await page.waitForTimeout(1500);
  const press = async (key: string, count: number) => {
    await scene.focus();
    for (let n = 0; n < count; n++) await page.keyboard.press(key);
    await scene.blur();
  };
  const samples = [];
  let held = false;
  const step = (delta: number, count: number) =>
    page.evaluate(
      async ({ delta, count }) => {
        await (window as unknown as { refractionClock: RefractionClock }).refractionClock.step(delta, count);
      },
      { delta, count },
    );
  for (const lighting of ['day', 'evening']) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await chooseSceneSetting(page, '3Dの時間帯', lighting);
    // Once held, state changes reach the renderer on explicit steps only.
    if (!held) {
      await settleRenderer(page);
      await page.evaluate(() => (window as unknown as { refractionClock: RefractionClock }).refractionClock.hold());
      held = true;
    }
    await step(0, 2);
    for (const [heading, pitch] of [
      [0, 'level'],
      [1, 'down'],
    ] as const) {
      await press('ArrowRight', 10 * heading);
      await press('ArrowDown', 32);
      if (pitch === 'level') await press('ArrowUp', 14);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await step(0, 72);
      for (let frame = 0; frame < 2; frame++) {
        await step(500, 72);
        const file = `${lighting}-${heading}-${pitch}-reduced-${frame}.png`;
        await canvas.screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
        samples.push({
          file,
          lighting,
          heading,
          pitch,
          mode: 'reduced',
          frame,
          clock: await page.evaluate(() => {
            const c = (window as unknown as { refractionClock: RefractionClock }).refractionClock;
            return { now: c.now, count: c.count };
          }),
        });
      }
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await step(0, 72);
      for (let frame = 0; frame < 36; frame++) {
        await step(1000 / 60, 2);
        const file = `${lighting}-${heading}-${pitch}-moving-${String(frame).padStart(3, '0')}.png`;
        await canvas.screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
        samples.push({
          file,
          lighting,
          heading,
          pitch,
          mode: 'moving',
          frame,
          clock: await page.evaluate(() => {
            const c = (window as unknown as { refractionClock: RefractionClock }).refractionClock;
            return { now: c.now, count: c.count };
          }),
        });
      }
      await press('ArrowLeft', 10 * heading);
    }
  }
  expect(errors).toEqual([]);
  await expect(scene).toHaveAttribute('data-temporal', 'on');
  await expect(scene).toHaveAttribute('data-pixel-ratio', '1');
  const hashes = Object.fromEntries(
    [
      'src/components/3d/refraction.ts',
      'src/components/3d/waterEffects.ts',
      'src/components/3d/depthPrepass.ts',
      'src/components/3d/shadowMask.ts',
      'src/components/3d/SaunaScene.tsx',
      'src/components/3d/waterBottom.ts',
      'src/components/3d/irradiance.ts',
      'src/components/3d/seasonal-light.json',
      'public/models/sauna.glb',
      'e2e/refraction-sway.visual.ts',
      'e2e/refraction-frame-control.ts',
    ].map((p) => [p, createHash('sha256').update(readFileSync(p)).digest('hex')]),
  );
  await info.attach('refraction-sway', {
    contentType: 'application/json',
    body: JSON.stringify({
      browser: browser.version(),
      viewport: page.viewportSize(),
      frames: 36,
      stepMs: 1000 / 60,
      quality: 'standard',
      samples,
      hashes,
      errors,
    }),
  });
});
