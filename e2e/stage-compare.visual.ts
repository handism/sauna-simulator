import { chooseSceneSetting } from './settings-controls';
import { expect, test } from '@playwright/test';
import { patchFrameCost, type FrameCostMode } from './frame-cost';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';
import { useModelCandidate } from './model-candidate';

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
// CAPTURE_QUALITY picks the 3D quality (standard by default); CAPTURE_PNG=1 keeps the captures
// lossless, for pixel comparisons of two builds.
const QUALITY = process.env.CAPTURE_QUALITY ?? 'standard';
const FORMAT = process.env.CAPTURE_PNG === '1' ? 'png' : 'jpeg';
// CAPTURE_DPR sets the device pixel ratio (the quality still caps the drawn one: standard 1.5).
test.use({ deviceScaleFactor: Number(process.env.CAPTURE_DPR ?? 1) });

test('capture the water stage views rendered in Cycles', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const candidate = await useModelCandidate(page);
  if (CUT) await page.addInitScript(patchFrameCost, CUT);
  // CAPTURE_QUERY adds to the query, e.g. &resolution=fixed to keep dynamic resolution from stepping.
  await page.goto(`?view=3d&frameRate=full${process.env.CAPTURE_QUERY ?? ''}`);
  await page.getByRole('button', { name: '音なしで入室する' }).click();
  const scene = page.locator('.sauna-3d-canvas');
  const canvas = scene.locator('canvas');
  await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 20_000 });
  // The woodland foliage loads after the ready scene.
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 20_000 });
  await chooseSceneSetting(page, '3Dの画質', QUALITY);
  await expect(scene).toHaveAttribute('data-quality', QUALITY);
  await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
  await expect(scene).toHaveAttribute('data-stage', 'water');
  await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
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
      await settleRenderer(page);
      const file = `stage-water-${lighting}-${heading}-${pitch}.${FORMAT === 'png' ? 'png' : 'jpg'}`;
      await canvas.screenshot({
        path: info.outputPath(file),
        type: FORMAT,
        ...(FORMAT === 'jpeg' ? { quality: 90 } : {}),
        style: rendererCaptureStyle,
      });
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
  if (candidate) expect(candidate.requests()).toBe(1);
  await info.attach('stage-compare', {
    contentType: 'application/json',
    body: JSON.stringify(
      {
        cut: CUT ?? null,
        quality: QUALITY,
        samples,
        bodyCandidate: candidate && {
          sha256: candidate.sha256,
          bytes: candidate.bytes,
          requests: candidate.requests(),
        },
      },
      null,
      2,
    ),
  });
});
