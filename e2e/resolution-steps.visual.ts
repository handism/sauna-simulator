import { expect, test } from '@playwright/test';
import { rendererCaptureStyle } from './scene-capture';

// What the steps of dynamic resolution (src/components/3d/dynamicResolution.ts) look like on a
// display of ratio 1.5 at the standard quality: each view is captured at 1.5, at 1.25 and at 1
// (frames made slow on the CPU until the ratio steps down, as dynamic-resolution.e2e.ts does), then
// at 1.5 again after a quality change resets the ratio, for the capture noise. Captures are the
// display's pixels (1800×1200), so the lower ratios show as the browser scales the canvas up.
// While a ratio is captured the animation frames get a held time: no window of the control loop
// ends, so the ratio holds whatever the frames cost (a view may miss 60 fps at 1.5 on its own).
// Reduced motion keeps the water and the lighting still, so the held time changes no image.
// Review artifacts, not an equivalence test.
test.use({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1.5 });

// The water stage's views as stage-compare.visual.ts turns them; the other stages' default views.
const WATER_VIEWS = [
  [0, 'level'],
  [2, 'level'],
  [4, 'level'],
  [1, 'down'],
] as const;
const RATIOS = ['1.5', '1.25', '1', '1.5'] as const;

function slowFrames() {
  const w = window as unknown as { suiSlow?: boolean; suiHold?: number };
  const request = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) =>
    request((time) => {
      if (w.suiSlow) for (const end = performance.now() + 30; performance.now() < end;);
      callback(w.suiHold ?? time);
    });
}

test('capture the dynamic resolution steps', async ({ page }, info) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(slowFrames);
  await page.goto('?view=3d');
  await page.getByRole('button', { name: '静かに入室する' }).click();
  const scene = page.locator('.sauna-3d-canvas');
  const canvas = scene.locator('canvas');
  await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 30_000 });
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
  await expect(scene).toHaveAttribute('data-resolution', 'auto');
  const quality = page.getByLabel('3Dの画質');
  await quality.selectOption('standard');
  await expect(scene).toHaveAttribute('data-pixel-ratio', '1.5');
  // Slow frames step the ratio down; a held time keeps it.
  const frames = (mode: 'slow' | 'hold' | 'free') =>
    page.evaluate((value) => {
      const w = window as unknown as { suiSlow: boolean; suiHold?: number };
      w.suiSlow = value === 'slow';
      w.suiHold = value === 'hold' ? performance.now() : undefined;
    }, mode);
  const press = async (key: string, count: number) => {
    await scene.focus();
    for (let n = 0; n < count; n++) await page.keyboard.press(key);
    await scene.blur();
  };
  const samples: object[] = [];
  const capture = async (stage: string, lighting: string, view: string) => {
    for (const [index, ratio] of RATIOS.entries()) {
      if (index === 0 || index === 3) {
        // A quality change returns to the largest ratio at once.
        await frames('hold');
        await quality.selectOption('low');
        await expect(scene).toHaveAttribute('data-pixel-ratio', '1');
        await quality.selectOption('standard');
      } else {
        await frames('slow');
        await expect(scene).toHaveAttribute('data-pixel-ratio', ratio, { timeout: 15_000 });
        await frames('hold');
      }
      await expect(scene).toHaveAttribute('data-pixel-ratio', ratio);
      // A few frames at the ratio (the held time still draws them).
      await page.waitForTimeout(1_500);
      await expect(scene).toHaveAttribute('data-pixel-ratio', ratio);
      const file = `${stage}-${lighting}-${view}-${index}.png`;
      await canvas.screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
      samples.push({
        file,
        stage,
        lighting,
        view,
        ratio: Number(ratio),
        repeat: index === 3,
        canvasWidth: await canvas.evaluate((c: HTMLCanvasElement) => c.width),
      });
    }
  };
  const stages = [
    ['sauna', '限界.. 水風呂へ 💧'],
    ['water', '外気浴へ 🍃'],
    ['totonou', null],
  ] as const;
  for (const [stage, next] of stages) {
    await expect(scene).toHaveAttribute('data-stage', stage);
    await page.waitForTimeout(1_200);
    for (const lighting of ['day', 'evening', 'night']) {
      await page.getByLabel('3Dの時間帯').selectOption(lighting);
      await expect(scene).toHaveAttribute('data-lighting', lighting);
      if (stage !== 'water') {
        await capture(stage, lighting, 'default');
        continue;
      }
      for (const [heading, pitch] of WATER_VIEWS) {
        await press('ArrowRight', 10 * heading);
        await press('ArrowDown', 32);
        if (pitch === 'level') await press('ArrowUp', 14);
        await capture(stage, lighting, `${heading}-${pitch}`);
        await press('ArrowLeft', 10 * heading);
      }
    }
    if (next) await page.getByRole('button', { name: next, exact: true }).click();
  }
  expect(errors).toEqual([]);
  await info.attach('resolution-steps', {
    contentType: 'application/json',
    body: JSON.stringify({ samples }, null, 2),
  });
});
