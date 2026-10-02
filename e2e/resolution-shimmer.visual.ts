import { expect, test } from '@playwright/test';
import { controlFrames, holdRatio } from './resolution-control';
import { rendererCaptureStyle } from './scene-capture';

// How the steps of dynamic resolution shimmer while looking around: each stage's default view at
// ratio 1.5, 1.25 and 1 (resolution-control.ts), dragged 1 px (0.004 rad of yaw) per frame for
// STEPS frames. A pure rotation maps each frame onto the next whatever the depth, so
// scripts/summarize_resolution_shimmer.py warps one onto the other and keeps what the motion does
// not explain (aliased edges popping). Review artifacts, not an equivalence test.
test.use({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1.5 });

const STEPS = 12;
const RATIOS = ['1.5', '1.25', '1'] as const;

test('capture the dynamic resolution steps while looking around', async ({ page }, info) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(controlFrames);
  await page.goto('?view=3d');
  await page.getByRole('button', { name: '静かに入室する' }).click();
  const scene = page.locator('.sauna-3d-canvas');
  const canvas = scene.locator('canvas');
  await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 30_000 });
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
  await page.getByLabel('3Dの画質').selectOption('standard');
  // The held time still draws a frame for each animation frame.
  const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const samples: object[] = [];
  for (const [stage, next] of [
    ['sauna', '限界.. 水風呂へ 💧'],
    ['water', '外気浴へ 🍃'],
    ['totonou', null],
  ] as const) {
    await expect(scene).toHaveAttribute('data-stage', stage);
    await page.waitForTimeout(1_200);
    for (const lighting of ['day', 'evening']) {
      await page.getByLabel('3Dの時間帯').selectOption(lighting);
      await expect(scene).toHaveAttribute('data-lighting', lighting);
      for (const ratio of RATIOS) {
        await holdRatio(page, scene, ratio);
        // The panels would take the drag.
        await page.getByRole('button', { name: 'UI非表示', exact: true }).click();
        await frame();
        const box = (await canvas.boundingBox())!;
        const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let step = 0; step <= STEPS; step++) {
          if (step > 0) await page.mouse.move(x + step, y);
          await frame();
          const file = `${stage}-${lighting}-${ratio}-${step}.png`;
          await canvas.screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
          samples.push({ file, stage, lighting, ratio: Number(ratio), step });
        }
        // Back to the default view.
        await page.mouse.move(x, y);
        await page.mouse.up();
        await page.getByRole('button', { name: 'UI表示', exact: true }).click();
        await expect(scene).toHaveAttribute('data-pixel-ratio', ratio);
      }
    }
    if (next) await page.getByRole('button', { name: next, exact: true }).click();
  }
  expect(errors).toEqual([]);
  await info.attach('resolution-shimmer', {
    contentType: 'application/json',
    body: JSON.stringify({ yawPerStep: 0.004, samples }, null, 2),
  });
});
