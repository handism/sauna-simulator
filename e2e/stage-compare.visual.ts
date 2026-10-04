import { chooseSceneSetting } from './settings-controls';
import { expect, test } from '@playwright/test';
import { patchFrameCost, type FrameCostMode } from './frame-cost';
import { rendererCaptureStyle } from './scene-capture';

// The water stage's seated view turned as scene-survey.visual.ts turns it, without the stage's
// DOM effects (its pulsing glow would differ between runs), for the Cycles renders of
// scripts/blender_stage_reference.py. Review artifacts, not an equivalence test.
const VIEWS = [
  [0, 'level'],
  [2, 'level'],
  [4, 'level'],
  [1, 'down'],
] as const;
// CAPTURE_CUT captures with a part of the pool floor's shading skipped (frame-cost.ts), to weigh a
// cut's image change against its cost.
const CUT = process.env.CAPTURE_CUT as FrameCostMode | undefined;

test('capture the water stage views rendered in Cycles', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  if (CUT) await page.addInitScript(patchFrameCost, CUT);
  await page.goto('?view=3d&frameRate=full');
  await page.getByRole('button', { name: '音なしで入室する' }).click();
  const scene = page.locator('.sauna-3d-canvas');
  const canvas = scene.locator('canvas');
  await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 20_000 });
  // The woodland foliage loads after the ready scene.
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 20_000 });
  await chooseSceneSetting(page, '3Dの画質', 'standard');
  await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
  await expect(scene).toHaveAttribute('data-stage', 'water');
  await page.getByRole('button', { name: 'UI非表示', exact: true }).click();
  await page.waitForTimeout(1200);
  const press = async (key: string, count: number) => {
    await scene.focus();
    for (let n = 0; n < count; n++) await page.keyboard.press(key);
  };
  const samples: object[] = [];
  for (const lighting of ['day', 'evening', 'night']) {
    await chooseSceneSetting(page, '3Dの時間帯', lighting);
    await expect(scene).toHaveAttribute('data-lighting', lighting);
    for (const [heading, pitch] of VIEWS) {
      // As the survey: heading n is 10n presses right; level is the lower clamp plus 14 presses up.
      await press('ArrowRight', 10 * heading);
      await press('ArrowDown', 32);
      if (pitch === 'level') await press('ArrowUp', 14);
      // The focus ring of the keyboard look would frame the capture.
      await scene.blur();
      const file = `stage-water-${lighting}-${heading}-${pitch}.jpg`;
      await canvas.screenshot({ path: info.outputPath(file), type: 'jpeg', quality: 90, style: rendererCaptureStyle });
      samples.push({
        file,
        lighting,
        heading,
        pitch,
        metrics: await scene.evaluate((e) => ({ ...(e as HTMLElement).dataset })),
      });
      await press('ArrowLeft', 10 * heading);
    }
  }
  if (CUT)
    expect(
      await page.evaluate(() => (window as unknown as { suiShadowSkips?: number }).suiShadowSkips ?? 0),
    ).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  await info.attach('stage-compare', {
    contentType: 'application/json',
    body: JSON.stringify({ cut: CUT ?? null, samples }, null, 2),
  });
});
