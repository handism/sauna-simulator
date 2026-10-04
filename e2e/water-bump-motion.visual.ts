import { chooseSceneSetting } from './settings-controls';
import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rendererCaptureStyle } from './scene-capture';

// Consecutive 60 fps frames of the plunge's frayed light patches (waterBottom.ts's bump) while the
// waves move, as lossless PNGs: the videos of auto-lighting.motion.ts are VP8 at 25 fps and blur
// single-pixel fraying. The renderer's rAF timestamp advances by 1/60 s per captured frame; the
// water's time follows it, extra frames and screenshots have delta 0. Review frames for
// scripts/analyze_water_bump_motion.py, not a perceptual verdict.
const STEP_MS = 1000 / 60;
const FRAMES = 72;
const VIEWS = [
  [1, 'down'],
  [2, 'level'],
] as const;

function controlFrames() {
  const state = { now: 1000 };
  (window as unknown as { bumpMotion: typeof state }).bumpMotion = state;
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = (callback) => raf.call(window, () => callback(state.now));
}

test('capture 60 fps frames of the frayed patches in the plunge', async ({ page, browser }, info) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(controlFrames);
  await page.goto('?view=3d');
  await page.getByRole('button', { name: '音なしで入室する' }).click();
  const scene = page.locator('.sauna-3d-canvas');
  const canvas = scene.locator('canvas');
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
  await chooseSceneSetting(page, '3Dの画質', 'standard');
  await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
  await expect(scene).toHaveAttribute('data-stage', 'water');
  await page.getByRole('button', { name: 'UI非表示', exact: true }).click();
  const advance = (ms: number) =>
    page.evaluate(async (step) => {
      (window as unknown as { bumpMotion: { now: number } }).bumpMotion.now += step;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, ms);
  // The stage transition's fade runs on timers, not on the frozen rAF clock.
  await page.waitForTimeout(1500);
  const press = async (key: string, count: number) => {
    await scene.focus();
    for (let n = 0; n < count; n++) await page.keyboard.press(key);
  };
  const samples: object[] = [];
  for (const lighting of ['evening', 'night']) {
    // Reduced motion snaps the light to its endpoint (and stops the waves), then the waves resume.
    await chooseSceneSetting(page, '3Dの時間帯', lighting);
    await expect(scene).toHaveAttribute('data-lighting', lighting);
    await advance(STEP_MS);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (const [heading, pitch] of VIEWS) {
      // As stage-compare.visual.ts.
      await press('ArrowRight', 10 * heading);
      await press('ArrowDown', 32);
      if (pitch === 'level') await press('ArrowUp', 14);
      await scene.blur();
      for (let frame = 0; frame < FRAMES; frame++) {
        await advance(STEP_MS);
        const file = `bump-${lighting}-${heading}-${pitch}-${String(frame).padStart(3, '0')}.png`;
        await canvas.screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
        const now = await page.evaluate(() => (window as unknown as { bumpMotion: { now: number } }).bumpMotion.now);
        samples.push({ file, lighting, heading, pitch, frame, now });
      }
      await press('ArrowLeft', 10 * heading);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
  }
  expect(errors).toEqual([]);
  const hashes = Object.fromEntries(
    [
      'src/components/3d/waterBottom.ts',
      'src/components/3d/waterEffects.ts',
      'e2e/water-bump-motion.visual.ts',
      'public/models/sauna.glb',
      'public/models/sauna.scene.json',
    ].map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]),
  );
  await info.attach('water-bump-motion', {
    contentType: 'application/json',
    body: JSON.stringify({
      browser: browser.version(),
      viewport: page.viewportSize(),
      stepMs: STEP_MS,
      hashes,
      dir: info.outputDir,
      samples,
      errors,
    }),
  });
});
