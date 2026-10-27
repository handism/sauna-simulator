import { chooseSceneSetting } from './settings-controls';
import { expect, test } from '@playwright/test';
import { controlFrames, holdRatio } from './resolution-control';
import { rendererCaptureStyle } from './scene-capture';
import { restoreTemporalVariance } from './temporal-variance-controls';
import { restoreLeafAlpha } from './leaf-alpha-controls';
import { verifyForestBuild } from './forest-build';
import { installRefractionClock, type RefractionClock } from './refraction-frame-control';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

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

// Optional seated heading for reviewing exposed distant forest rather than only the default view.
const HEADING_STEPS = Number(process.env.SHIMMER_HEADING_STEPS ?? 0);
if (!Number.isInteger(HEADING_STEPS) || HEADING_STEPS < 0 || HEADING_STEPS > 78)
  throw Error('Invalid SHIMMER_HEADING_STEPS');
const FIXED_RATIO = process.env.SHIMMER_FIXED === '1';
const CONTROLLED = process.env.SHIMMER_CONTROLLED === '1';
if (CONTROLLED && !FIXED_RATIO) throw Error('Controlled shimmer capture requires SHIMMER_FIXED=1');
const STEPS = 12;
const PX = Number(process.env.SHIMMER_PX ?? 1);
const FRAMES = Number(process.env.SHIMMER_FRAMES ?? 2);
const RATIOS = (process.env.SHIMMER_RATIOS ?? (QUALITY === 'high' ? '2,1.75,1.5,1.25' : '1.5,1.25,1')).split(',');

// SHIMMER_CONTROL=leaf-alpha takes the woodland cards' unbiased alpha (leaf-alpha-controls.ts) as the
// before runs' control instead of the earlier temporal variance bound.
const CONTROL = process.env.SHIMMER_CONTROL ?? 'temporal-variance';
if (CONTROL !== 'temporal-variance' && CONTROL !== 'leaf-alpha') throw Error('Invalid SHIMMER_CONTROL');
const runs = process.env.SHIMMER_ABBA === '1' ? ['before1', 'after1', 'after2', 'before2'] : ['product'];
for (const run of runs) {
  test(`capture the dynamic resolution steps while looking around ${run}`, async ({ page, browser }, info) => {
    test.setTimeout(900_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.addInitScript(CONTROLLED ? installRefractionClock : controlFrames);
    if (run.startsWith('before'))
      await page.addInitScript(CONTROL === 'leaf-alpha' ? restoreLeafAlpha : restoreTemporalVariance);
    await page.goto(
      `?sound=off&quality&view=3d&frameRate=full${FIXED_RATIO ? `&resolution=fixed&quality=${QUALITY}` : ''}${process.env.SHIMMER_QUERY ?? ''}`,
    );
    await page.getByRole('button', { name: '入室する', exact: true }).click();
    const scene = page.locator('.sauna-3d-canvas');
    const canvas = scene.locator('canvas');
    await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 30_000 });
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
    const forestBuild = process.env.FOREST_REVIEW === 'visual' ? await verifyForestBuild(page) : undefined;
    await chooseSceneSetting(page, '3Dの画質', QUALITY);
    // Applied once its programs have compiled.
    await expect(scene).toHaveAttribute('data-quality', QUALITY);
    // The held time still draws a frame for each animation frame.
    const frame = (count = 2) =>
      CONTROLLED
        ? page.evaluate(
            (count) => (window as unknown as { refractionClock: RefractionClock }).refractionClock.step(0, count),
            count,
          )
        : page.evaluate(
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
      await scene.focus();
      for (let n = 0; n < HEADING_STEPS; n++) await page.keyboard.press('ArrowRight');
      for (const lighting of ['day', 'evening']) {
        await chooseSceneSetting(page, '3Dの時間帯', lighting);
        await expect(scene).toHaveAttribute('data-lighting', lighting);
        for (const ratio of RATIOS) {
          if (FIXED_RATIO) {
            await expect(scene).toHaveAttribute('data-pixel-ratio', ratio);
            if (CONTROLLED)
              await page.evaluate(() =>
                (window as unknown as { refractionClock: RefractionClock }).refractionClock.hold(),
              );
            else
              await page.evaluate(() => {
                (window as unknown as { suiHold: number }).suiHold = performance.now();
              });
            await frame(70);
          } else await holdRatio(page, scene, ratio, QUALITY);
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
            const frameCount = CONTROLLED
              ? await page.evaluate(
                  () => (window as unknown as { refractionClock: RefractionClock }).refractionClock.count,
                )
              : undefined;
            samples.push({ file, stage, lighting, ratio: Number(ratio), step, frameCount });
          }
          // Back to the default view.
          await page.mouse.move(x, y);
          await page.mouse.up();
          await page.getByRole('button', { name: '操作を表示', exact: true }).click();
          await expect(scene).toHaveAttribute('data-pixel-ratio', ratio);
          if (CONTROLLED)
            await page.evaluate(async () => {
              const clock = (window as unknown as { refractionClock: RefractionClock }).refractionClock;
              clock.held = false;
              await clock.step(0);
            });
        }
      }
      await scene.focus();
      for (let n = 0; n < HEADING_STEPS; n++) await page.keyboard.press('ArrowLeft');
      if (next) await page.getByRole('button', { name: next, exact: true }).click();
    }
    expect(errors).toEqual([]);
    const controls = await page.evaluate(() => (window as any).shimmerControls ?? 0);
    if (run.startsWith('before')) expect(controls).toBeGreaterThan(0);
    else expect(controls).toBe(0);
    await info.attach('resolution-shimmer', {
      contentType: 'application/json',
      body: JSON.stringify(
        {
          browser: browser.version(),
          forestBuild,
          run,
          controls,
          control: CONTROL,
          query: process.env.SHIMMER_QUERY ?? '',
          sourceHash: createHash('sha256').update(readFileSync('src/components/3d/temporalAA.ts')).digest('hex'),
          headingSteps: HEADING_STEPS,
          fixedResolution: FIXED_RATIO,
          controlledFrames: CONTROLLED,
          quality: QUALITY,
          yawPerStep: 0.004 * PX,
          framesPerStep: FRAMES,
          samples,
        },
        null,
        2,
      ),
    });
  });
}
