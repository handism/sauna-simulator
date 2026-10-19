import { expect, test } from '@playwright/test';
import { chooseSceneSetting } from './settings-controls';
import { timeFrames } from './gpu-timer';
import { restoreTemporalVariance } from './temporal-variance-controls';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Repeat three draws with a tiny alternating pointer move after each. Unlike a static scene,
// this keeps the actual temporal resolve active throughout the measured window.
test.use({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1.5, reducedMotion: 'reduce' });
for (const run of ['warmup', 'before1', 'after1', 'after2', 'before2']) {
  test(`temporal variance cost ${run}`, async ({ page, browser }, info) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.addInitScript(timeFrames, 3);
    await page.addInitScript(() => {
      const p = WebGL2RenderingContext.prototype;
      const shaders = new WeakSet<WebGLShader>();
      const programs = new WeakSet<WebGLProgram>();
      let temporal = false;
      const source = p.shaderSource,
        attach = p.attachShader,
        use = p.useProgram,
        draw = p.drawArrays;
      p.shaderSource = function (shader, text) {
        if (text.includes('const float historySigma =')) shaders.add(shader);
        source.call(this, shader, text);
      };
      p.attachShader = function (program, shader) {
        if (shaders.has(shader)) programs.add(program);
        attach.call(this, program, shader);
      };
      p.useProgram = function (program) {
        temporal = program !== null && programs.has(program);
        use.call(this, program);
      };
      p.drawArrays = function (mode, first, count) {
        if (temporal) (window as any).suiTemporalDraws++;
        draw.call(this, mode, first, count);
      };
    });
    if (run.startsWith('before')) await page.addInitScript(restoreTemporalVariance);
    await page.goto('?sound=off&view=3d&quality=standard&resolution=fixed&frameRate=full');
    await page.getByRole('button', { name: '入室する', exact: true }).click();
    const scene = page.locator('.sauna-3d-canvas');
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
    await expect(scene).toHaveAttribute('data-temporal', 'on');
    const samples = [];
    for (const [stage, next] of [
      ['sauna', '水風呂へ'],
      ['water', '外気浴へ'],
      ['totonou', null],
    ] as const) {
      await expect(scene).toHaveAttribute('data-stage', stage);
      await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
      for (const lighting of ['day', 'night']) {
        await chooseSceneSetting(page, '3Dの時間帯', lighting);
        await expect(scene).toHaveAttribute('data-lighting', lighting);
        const box = (await scene.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.evaluate(
          ({ x, y }) => {
            const w = window as any;
            let step = 0;
            w.suiAfterDraw = () => {
              step++;
              document.querySelector('.sauna-3d-canvas')!.dispatchEvent(
                new PointerEvent('pointermove', {
                  pointerId: 1,
                  clientX: x + (step % 2),
                  clientY: y,
                  buttons: 1,
                  isPrimary: true,
                }),
              );
            };
          },
          { x: box.x + box.width / 2, y: box.y + box.height / 2 },
        );
        await page.waitForTimeout(2000);
        await page.evaluate(() => {
          const w = window as any;
          w.suiFrameAt = [];
          w.suiGpuMs = [];
          w.suiMeasure = true;
          w.suiTemporalDraws = 0;
        });
        await page.waitForTimeout(3000);
        const frames: number[] = await page.evaluate(() => {
          const w = window as any;
          w.suiMeasure = false;
          w.suiAfterDraw = undefined;
          return w.suiFrameAt;
        });
        await page.mouse.up();
        expect(frames.length).toBeGreaterThan(20);
        const temporalDraws = await page.evaluate(() => (window as any).suiTemporalDraws as number);
        expect(temporalDraws).toBeGreaterThan(frames.length * 2);
        samples.push({
          stage,
          lighting,
          frames: frames.length,
          temporalDraws,
          intervalMeanMs: (frames.at(-1)! - frames[0]) / (frames.length - 1) / 3,
          metrics: await scene.evaluate((e) => ({ ...(e as HTMLElement).dataset })),
        });
      }
      await page.getByRole('button', { name: '操作を表示', exact: true }).click();
      if (next) await page.getByRole('button', { name: next, exact: true }).click();
    }
    const controls = await page.evaluate(() => (window as any).shimmerControls ?? 0);
    expect(controls > 0).toBe(run.startsWith('before'));
    expect(errors).toEqual([]);
    await info.attach('temporal-cost', {
      contentType: 'application/json',
      body: JSON.stringify({
        run,
        browser: browser.version(),
        repeat: 3,
        dpr: 1.5,
        size: [1200, 800],
        controls,
        samples,
        errors,
        sourceHash: createHash('sha256').update(readFileSync('src/components/3d/temporalAA.ts')).digest('hex'),
      }),
    });
  });
}
