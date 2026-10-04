import { chooseSceneSetting } from './settings-controls';
import { expect, test } from '@playwright/test';
import { BLOCKER_SAMPLES, FILTER_SAMPLES } from '../src/components/3d/softShadows.ts';
import { timeFrames } from './gpu-timer';
import { PCSS_VARIANTS, type ShadowVariant, patchShadows } from './shadow-variants';

test('GPU timer excludes callbacks without WebGL draws', async ({ page }) => {
  await page.addInitScript(timeFrames);
  await page.goto('about:blank');
  const supported = await page.evaluate(async () => {
    const gl = document.createElement('canvas').getContext('webgl2')!;
    const w = window as unknown as { suiTimer?: object; suiMeasure: boolean; suiGpuMs: number[] };
    if (!w.suiTimer) return false;
    const program = gl.createProgram()!;
    for (const [type, source] of [
      [
        gl.VERTEX_SHADER,
        '#version 300 es\nvoid main() { gl_Position = vec4(float(gl_VertexID) - 1.0, 0.0, 0.0, 1.0); gl_PointSize = 1.0; }',
      ],
      [
        gl.FRAGMENT_SHADER,
        '#version 300 es\nprecision highp float; out vec4 color; void main() { color = vec4(1.0); }',
      ],
    ] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)!);
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
    gl.useProgram(program);
    w.suiMeasure = true;
    for (let i = 0; i < 8; i++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          if (i % 2 === 0) gl.drawArrays(gl.POINTS, 0, 3);
          resolve();
        }),
      );
    }
    w.suiMeasure = false;
    // Continue rAF callbacks to collect asynchronous query results.
    for (let i = 0; i < 60; i++) await new Promise(requestAnimationFrame);
    gl.deleteProgram(program);
    return true;
  });
  test.skip(!supported, 'GPU timer extension unavailable');
  expect(await page.evaluate(() => (window as unknown as { suiGpuMs: number[] }).suiGpuMs.length)).toBe(4);
});

// Ablations run only in this browser (shadow-variants.ts): 16+24 samples, 8+12, and hard shadows.
// SHADOW_COST_VARIANTS=a,b,... measures those variants instead, in that order and reversed.
const COST_VARIANTS = (process.env.SHADOW_COST_VARIANTS?.split(',') ?? ['original', 'half', 'hard']) as ShadowVariant[];
for (const variant of COST_VARIANTS) if (!(variant in PCSS_VARIANTS)) throw new Error(`Unknown variant ${variant}`);
// SHADOW_COST_LIGHTINGS=night measures other times of day (the moon for sun-quarter, for example).
const COST_LIGHTINGS = process.env.SHADOW_COST_LIGHTINGS?.split(',') ?? ['day', 'evening'];
for (const [run, variants] of [
  ['forward', COST_VARIANTS],
  ['reverse', [...COST_VARIANTS].reverse()],
] as const) {
  for (const variant of variants) {
    test(`shadow cost ${run} ${variant}`, async ({ page, browser }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.addInitScript(timeFrames);
      await page.addInitScript(patchShadows, {
        from: [BLOCKER_SAMPLES, FILTER_SAMPLES],
        to: PCSS_VARIANTS[variant],
      });
      await page.goto('?view=3d');
      await page.getByRole('button', { name: '音なしで入室する' }).click();
      const scene = page.locator('.sauna-3d-canvas');
      await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
      test.skip(
        !(await page.evaluate(() => Boolean((window as unknown as { suiTimer?: object }).suiTimer))),
        'GPU timer extension unavailable',
      );
      await chooseSceneSetting(page, '3Dの画質', 'high');
      await expect(scene).toHaveAttribute('data-quality', 'high');
      const samples: object[] = [];
      for (const [stage, next] of [
        ['sauna', '水風呂へ'],
        ['water', '外気浴へ'],
        ['totonou', null],
      ] as const) {
        await expect(scene).toHaveAttribute('data-stage', stage);
        for (const lighting of COST_LIGHTINGS) {
          await chooseSceneSetting(page, '3Dの時間帯', lighting);
          await expect(scene).toHaveAttribute('data-lighting', lighting);
          await page.waitForTimeout(3000);
          await page.evaluate(() => {
            const w = window as unknown as { suiGpuMs: number[]; suiMeasure: boolean };
            w.suiGpuMs = [];
            w.suiMeasure = true;
          });
          await page.waitForTimeout(4000);
          await page.evaluate(() => {
            (window as unknown as { suiMeasure: boolean }).suiMeasure = false;
          });
          // Drain outstanding queries before the next condition.
          await page.waitForTimeout(1000);
          const times = await page.evaluate(() => (window as unknown as { suiGpuMs: number[] }).suiGpuMs);
          expect(times.length).toBeGreaterThan(20);
          const sorted = [...times].sort((a, b) => a - b);
          samples.push({
            stage,
            lighting,
            frames: times.length,
            gpuMs: {
              p10: sorted[Math.floor(sorted.length * 0.1)],
              median: sorted[Math.floor(sorted.length * 0.5)],
              p90: sorted[Math.floor(sorted.length * 0.9)],
            },
            metrics: await scene.evaluate((element) => ({ ...(element as HTMLElement).dataset })),
          });
        }
        if (next) await page.getByRole('button', { name: next, exact: true }).click();
      }
      const patches = await page.evaluate(() => (window as unknown as { shadowPatches: number }).shadowPatches);
      expect(patches).toBeGreaterThan(0);
      expect(errors).toEqual([]);
      await info.attach('shadow-cost', {
        contentType: 'application/json',
        body: JSON.stringify(
          { run, variant, browser: browser.version(), viewport: page.viewportSize(), patches, samples, errors },
          null,
          2,
        ),
      });
    });
  }
}
