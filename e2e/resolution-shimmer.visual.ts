import { chooseSceneSetting } from './settings-controls';
import { expect, test } from '@playwright/test';
import { controlFrames, holdRatio } from './resolution-control';
import { rendererCaptureStyle } from './scene-capture';

// How the steps of dynamic resolution shimmer while looking around: each stage's default view at
// ratio 1.5, 1.25 and 1 (resolution-control.ts), dragged 1 px (0.004 rad of yaw) per frame for
// STEPS frames. A pure rotation maps each frame onto the next whatever the depth, so
// scripts/summarize_resolution_shimmer.py warps one onto the other and keeps what the motion does
// not explain (aliased edges popping). Review artifacts, not an equivalence test.
// SHIMMER_PX (CSS px per step, default 1), SHIMMER_FRAMES (animation frames per step, default 2),
// SHIMMER_RATIOS (comma separated, default all) and SHIMMER_QUERY (added to the URL, e.g.
// &temporal=off) measure faster turns and compare builds' settings. SHIMMER_QUALITY=high takes the
// high quality on a display of ratio 2 (its steps 2,1.75,1.5,1.25 by default).
const QUALITY = process.env.SHIMMER_QUALITY === 'high' ? 'high' : 'standard';
test.use({
  viewport: { width: 1200, height: 800 },
  deviceScaleFactor: QUALITY === 'high' ? 2 : 1.5,
});

const STEPS = 12;
const PX = Number(process.env.SHIMMER_PX ?? 1);
const FRAMES = Number(process.env.SHIMMER_FRAMES ?? 2);
const RATIOS = (process.env.SHIMMER_RATIOS ?? (QUALITY === 'high' ? '2,1.75,1.5,1.25' : '1.5,1.25,1')).split(',');

test('capture the dynamic resolution steps while looking around', async ({ page }, info) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(controlFrames);
  await page.goto(`?view=3d&frameRate=full${process.env.SHIMMER_QUERY ?? ''}`);
  await page.getByRole('button', { name: '音なしで入室する' }).click();
  const scene = page.locator('.sauna-3d-canvas');
  const canvas = scene.locator('canvas');
  await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 30_000 });
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
  await chooseSceneSetting(page, '3Dの画質', QUALITY);
  // Applied once its programs have compiled.
  await expect(scene).toHaveAttribute('data-quality', QUALITY);
  // The held time still draws a frame for each animation frame.
  const frame = (count = 2) =>
    page.evaluate(
      (n) =>
        new Promise<void>((resolve) => {
          const next = () => (n-- > 0 ? requestAnimationFrame(next) : resolve());
          next();
        }),
      count,
    );
  const samples: object[] = [];
  for (const [stage, next] of [
    ['sauna', '水風呂へ'],
    ['water', '外気浴へ'],
    ['totonou', null],
  ] as const) {
    await expect(scene).toHaveAttribute('data-stage', stage);
    await page.waitForTimeout(1_200);
    for (const lighting of ['day', 'evening']) {
      await chooseSceneSetting(page, '3Dの時間帯', lighting);
      await expect(scene).toHaveAttribute('data-lighting', lighting);
      for (const ratio of RATIOS) {
        await holdRatio(page, scene, ratio, QUALITY);
        // The panels would take the drag.
        await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
        await frame();
        const box = (await canvas.boundingBox())!;
        // Centred on the drag, so a fast one stays on the canvas.
        const [x, y] = [box.x + box.width / 2 - (STEPS * PX) / 2, box.y + box.height / 2];
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let step = 0; step <= STEPS; step++) {
          if (step > 0) await page.mouse.move(x + step * PX, y);
          await frame(FRAMES);
          const file = `${stage}-${lighting}-${ratio}-${step}.png`;
          await canvas.screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
          samples.push({ file, stage, lighting, ratio: Number(ratio), step });
        }
        // Back to the default view.
        await page.mouse.move(x, y);
        await page.mouse.up();
        await page.getByRole('button', { name: '操作を表示', exact: true }).click();
        await expect(scene).toHaveAttribute('data-pixel-ratio', ratio);
      }
    }
    if (next) await page.getByRole('button', { name: next, exact: true }).click();
  }
  expect(errors).toEqual([]);
  await info.attach('resolution-shimmer', {
    contentType: 'application/json',
    body: JSON.stringify({ quality: QUALITY, yawPerStep: 0.004 * PX, framesPerStep: FRAMES, samples }, null, 2),
  });
});
