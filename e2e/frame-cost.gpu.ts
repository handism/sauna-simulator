import { chooseSceneSetting } from './settings-controls';
import { expect, test, type Page } from '@playwright/test';
import { patchFrameCost, type FrameCostMode } from './frame-cost';
import { timeFrames } from './gpu-timer';

// FRAME_COST_DPR sets the device pixel ratio (the quality preset still caps it: standard 1.5, high 2).
const DPR = Number(process.env.FRAME_COST_DPR ?? 1);
// FRAME_COST_REPEAT draws every frame that many times in one timed callback (gpu-timer.ts).
const REPEAT = Number(process.env.FRAME_COST_REPEAT ?? 1);
if (!(DPR > 0) || !Number.isInteger(REPEAT) || REPEAT < 1)
  throw new Error(`FRAME_COST_DPR ${process.env.FRAME_COST_DPR} or FRAME_COST_REPEAT ${process.env.FRAME_COST_REPEAT}`);
test.use({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: DPR });

// Where a frame's GPU time goes, by ablation (frame-cost.ts): the product against every scene
// fragment shader returning a constant, in the order product, trivial, trivial, product; then the
// fragments shaded per pixel. Default views of the three stages by day, dusk and night, at the
// standard quality (FRAME_COST_QUALITY=high for the high one). A diagnosis on one machine.
// FRAME_COST_VARIANTS picks other orders and variants, e.g. warmup,product,noshadow-sun,...,product;
// `warmup` is the product in a first test that summaries leave out (the first page after launch
// timed 2–4x slower).
const QUALITY = process.env.FRAME_COST_QUALITY ?? 'standard';
const STAGES = [
  ['sauna', '水風呂へ'],
  ['water', '外気浴へ'],
  ['totonou', null],
] as const;

async function enter(page: Page) {
  // At the set ratio: dynamic resolution would step down from it in the slower views.
  await page.goto(`?view=3d&frameRate=full&resolution=fixed${process.env.FRAME_COST_QUERY ?? ''}`);
  await page.getByRole('button', { name: '音なしで入室する' }).click();
  const scene = page.locator('.sauna-3d-canvas');
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
  await chooseSceneSetting(page, '3Dの画質', QUALITY);
  // Applied once its programs have compiled.
  await expect(scene).toHaveAttribute('data-quality', QUALITY);
  return scene;
}

async function eachView(page: Page, measure: (stage: string, lighting: string) => Promise<void>) {
  const scene = page.locator('.sauna-3d-canvas');
  for (const [stage, next] of STAGES) {
    await expect(scene).toHaveAttribute('data-stage', stage);
    await page.getByRole('button', { name: 'UI非表示', exact: true }).click();
    for (const lighting of ['day', 'evening', 'night']) {
      await chooseSceneSetting(page, '3Dの時間帯', lighting);
      await expect(scene).toHaveAttribute('data-lighting', lighting);
      // Past the stage fade and the shader compiles of the lighting change.
      await page.waitForTimeout(2500);
      await measure(stage, lighting);
    }
    await page.getByRole('button', { name: 'UI表示', exact: true }).click();
    if (next) await page.getByRole('button', { name: next, exact: true }).click();
  }
}

for (const [index, variant] of (
  (process.env.FRAME_COST_VARIANTS?.split(',') ?? ['product', 'trivial', 'trivial', 'product']) as (
    'product' | 'warmup' | Exclude<FrameCostMode, 'overdraw'>
  )[]
).entries()) {
  test(`frame cost ${index} ${variant}`, async ({ page, browser }, info) => {
    test.setTimeout(180_000);
    await page.addInitScript(timeFrames, REPEAT);
    if (variant !== 'product' && variant !== 'warmup') await page.addInitScript(patchFrameCost, variant);
    // A material whose shader fails to compile is not drawn, and the frame looks cheaper.
    const shaderErrors: string[] = [];
    page.on('console', (message) => {
      if (/WebGLProgram: Shader Error/.test(message.text())) shaderErrors.push(message.text().slice(0, 300));
    });
    const scene = await enter(page);
    test.skip(
      !(await page.evaluate(() => Boolean((window as unknown as { suiTimer?: object }).suiTimer))),
      'EXT_disjoint_timer_query_webgl2 is not available',
    );
    const skips = () => page.evaluate(() => (window as unknown as { suiShadowSkips?: number }).suiShadowSkips ?? 0);
    const results: object[] = [];
    await eachView(page, async (stage, lighting) => {
      await page.evaluate(() => {
        const w = window as unknown as { suiGpuMs: number[]; suiFrameAt: number[]; suiMeasure: boolean };
        w.suiGpuMs = [];
        w.suiFrameAt = [];
        w.suiMeasure = true;
      });
      await page.waitForTimeout(4000);
      await page.evaluate(() => ((window as unknown as { suiMeasure: boolean }).suiMeasure = false));
      // Queries finish a few frames later.
      await page.waitForTimeout(1000);
      const times = await page.evaluate(() => (window as unknown as { suiGpuMs: number[] }).suiGpuMs);
      expect(times.length).toBeGreaterThan(10);
      const frameAt = await page.evaluate(() => (window as unknown as { suiFrameAt: number[] }).suiFrameAt);
      const quantiles = (values: number[]) => {
        const sorted = [...values].sort((a, b) => a - b);
        const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
        return { p10: at(0.1), median: at(0.5), p90: at(0.9) };
      };
      results.push({
        stage,
        lighting,
        frames: times.length,
        gpuMs: quantiles(times),
        // Per drawn frame, divided by the repeat: the cost of one frame when the GPU is the limit.
        // The mean is the throughput; single intervals are whole display intervals.
        intervalMs: {
          ...quantiles(frameAt.slice(1).map((t, i) => (t - frameAt[i]) / REPEAT)),
          mean: (frameAt[frameAt.length - 1] - frameAt[0]) / (frameAt.length - 1) / REPEAT,
        },
        metrics: await scene.evaluate((element) => ({ ...(element as HTMLElement).dataset })),
      });
    });
    // A shadow variant that no longer matches the shaders would time the product.
    if (
      variant.startsWith('noshadow-') ||
      variant.startsWith('trivial-') ||
      variant.startsWith('cut-') ||
      variant === 'rolled' ||
      variant === 'rotate' ||
      variant === 'depth16'
    )
      expect(await skips()).toBeGreaterThan(0);
    expect(shaderErrors).toEqual([]);
    await info.attach('frame-cost', {
      contentType: 'application/json',
      body: JSON.stringify({
        browser: browser.version(),
        variant,
        index,
        quality: QUALITY,
        dpr: DPR,
        repeat: REPEAT,
        results,
      }),
    });
  });
}

test('fragments shaded per pixel', async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  await page.addInitScript(patchFrameCost, 'overdraw' as const);
  await enter(page);
  const results: object[] = [];
  await eachView(page, async (stage, lighting) => {
    await page.evaluate(() => ((window as unknown as { suiOverdrawRead: boolean }).suiOverdrawRead = true));
    await page.waitForFunction(() => !(window as unknown as { suiOverdrawRead: boolean }).suiOverdrawRead);
    const histogram = await page.evaluate(() => (window as unknown as { suiOverdraw: number[] }).suiOverdraw);
    const pixels = histogram.reduce((a, b) => a + b, 0);
    const mean = histogram.reduce((sum, count, layers) => sum + count * layers, 0) / pixels;
    results.push({ stage, lighting, mean, histogram });
  });
  await info.attach('overdraw', {
    contentType: 'application/json',
    body: JSON.stringify({ browser: browser.version(), quality: QUALITY, results }),
  });
});
