import { chooseSceneSetting } from './settings-controls';
import { expect, test } from '@playwright/test';
import { BLOCKER_SAMPLES, FILTER_SAMPLES } from '../src/components/3d/softShadows.ts';
import { rendererCaptureStyle } from './scene-capture';
import { PCSS_VARIANTS, type ShadowVariant, patchShadows } from './shadow-variants';

// PCSS sample counts compared at the same poses: each stage's default view, then a slow drag
// (1 px = 0.004 rad per step). The per-pixel rotation of the sample disk is fixed to the screen,
// so fewer samples can make penumbra grain crawl while looking around; scripts/compare_shadow_samples.py
// measures each variant's error against the many-sample reference and how it changes between
// frames. 'original' runs twice to bound the capture noise. Review artifacts, not a quality pass.
// SHADOW_CANDIDATES=a,b,... compares those variants of shadow-variants.ts instead of 8+12.
const STEPS = 8;
const CANDIDATES = (process.env.SHADOW_CANDIDATES?.split(',') ?? ['half']) as ShadowVariant[];
for (const variant of CANDIDATES) if (!(variant in PCSS_VARIANTS)) throw new Error(`Unknown variant ${variant}`);

for (const [label, variant] of [
  ['reference', 'reference'],
  ['original', 'original'],
  ...CANDIDATES.map((candidate) => [candidate, candidate] as const),
  ['original-repeat', 'original'],
] as const) {
  test(`capture shadow samples ${label}`, async ({ page, browser }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(patchShadows, { from: [BLOCKER_SAMPLES, FILTER_SAMPLES], to: PCSS_VARIANTS[variant] });
    await page.goto('?view=3d&frameRate=full');
    await page.getByRole('button', { name: '音なしで入室する' }).click();
    const scene = page.locator('.sauna-3d-canvas');
    const canvas = scene.locator('canvas');
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
    await chooseSceneSetting(page, '3Dの画質', 'high');
    await expect(scene).toHaveAttribute('data-quality', 'high');
    const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const samples: object[] = [];
    for (const [stage, next] of [
      ['sauna', '水風呂へ'],
      ['water', '外気浴へ'],
      ['totonou', null],
    ] as const) {
      await expect(scene).toHaveAttribute('data-stage', stage);
      await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
      await page.waitForTimeout(1200);
      for (const lighting of ['day', 'evening']) {
        await chooseSceneSetting(page, '3Dの時間帯', lighting);
        await expect(scene).toHaveAttribute('data-lighting', lighting);
        await page.waitForTimeout(500);
        const box = (await canvas.boundingBox())!;
        const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let step = 0; step <= STEPS; step++) {
          if (step > 0) await page.mouse.move(x + step, y);
          await frame();
          const file = `${stage}-${lighting}-${step}.png`;
          await canvas.screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
          samples.push({ file, stage, lighting, step });
        }
        await page.mouse.move(x, y);
        await page.mouse.up();
      }
      await page.getByRole('button', { name: '操作を表示', exact: true }).click();
      if (next) await page.getByRole('button', { name: next, exact: true }).click();
    }
    expect(await page.evaluate(() => (window as unknown as { shadowPatches: number }).shadowPatches)).toBeGreaterThan(
      0,
    );
    expect(errors).toEqual([]);
    await info.attach('shadow-samples', {
      contentType: 'application/json',
      body: JSON.stringify(
        {
          label,
          samples: PCSS_VARIANTS[variant],
          browser: browser.version(),
          viewport: page.viewportSize(),
          dir: info.outputDir,
          frames: samples,
        },
        null,
        2,
      ),
    });
  });
}
