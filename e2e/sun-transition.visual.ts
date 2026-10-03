import { chooseSceneSetting } from './settings-controls';
import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rendererCaptureStyle } from './scene-capture';

// Advance the renderer's rAF timestamp explicitly. Native frames continue (including shader
// compilation), but extra frames and screenshots have delta=0 and cannot move the light blend.
// This exercises lighting.update with motion enabled, not a replacement blend in the shader.
function controlFrames(before: boolean) {
  const state = { now: 1000, sun: [0, 0, 0], patches: 0 };
  (window as unknown as { sunReview: typeof state }).sunReview = state;
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = (callback) => raf.call(window, () => callback(state.now));
  const gl = WebGL2RenderingContext.prototype;
  const location = gl.getUniformLocation;
  const locations = new WeakSet<WebGLUniformLocation>();
  gl.getUniformLocation = function (program, name) {
    const result = location.call(this, program, name);
    if (result && name === 'directionalLights[0].color') locations.add(result);
    return result;
  };
  const color = gl.uniform3f;
  gl.uniform3f = function (location, r, g, b) {
    if (location && locations.has(location)) state.sun = [r, g, b];
    color.call(this, location, r, g, b);
  };
  const shaderSource = gl.shaderSource;
  gl.shaderSource = function (shader, source) {
    const call = 'suiSunShadow( directLight.color, directionalShadowMap[';
    if (source.includes(call)) {
      state.patches++;
      if (before) source = source.replaceAll(call, 'getShadow( directionalShadowMap[');
    }
    shaderSource.call(this, shader, source);
  };
}

for (const quality of ['standard', 'high']) {
  for (const mode of ['product', 'before', 'product-repeat']) {
    test(`sun transition ${quality} ${mode}`, async ({ page, browser }, info) => {
      test.setTimeout(240_000);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await page.addInitScript(controlFrames, mode === 'before');
      await page.goto('?view=3d');
      await page.getByRole('button', { name: '静かに入室する' }).click();
      const scene = page.locator('.sauna-3d-canvas');
      await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
      await chooseSceneSetting(page, '3Dの画質', quality);
      const advance = () =>
        page.evaluate(async () => {
          const state = (window as unknown as { sunReview: { now: number } }).sunReview;
          state.now += 100;
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
      const samples: object[] = [];
      for (const [stage, next] of [
        ['sauna', '水風呂へ'],
        ['water', '外気浴へ'],
        ['totonou', null],
      ] as const) {
        await expect(scene).toHaveAttribute('data-stage', stage);
        // Snap to the day endpoint, then restore the real interpolation for both directions.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await chooseSceneSetting(page, '3Dの時間帯', 'day');
        await advance();
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.getByRole('button', { name: 'UI非表示', exact: true }).click();
        for (const direction of ['evening', 'day']) {
          await chooseSceneSetting(page, '3Dの時間帯', direction);
          const seen = new Set<boolean>();
          for (let step = 0; step <= (direction === 'evening' ? 62 : 3); step++) {
            if (step) await advance();
            if (direction === 'evening' && step < 53) continue;
            const state = await page.evaluate(
              () =>
                (
                  window as unknown as {
                    sunReview: { now: number; sun: number[]; patches: number };
                  }
                ).sunReview,
            );
            expect(state.patches).toBeGreaterThan(0);
            expect(Math.max(...state.sun)).toBeGreaterThan(0);
            seen.add(Math.max(...state.sun) < 0.1);
            const file = `${stage}-${direction}-${step}.png`;
            await scene.locator('canvas').screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
            samples.push({ file, stage, direction, step, ...state });
          }
          expect([...seen].sort()).toEqual([false, true]);
        }
        await page.getByRole('button', { name: 'UI表示', exact: true }).click();
        if (next) await page.getByRole('button', { name: next, exact: true }).click();
      }
      expect(errors).toEqual([]);
      const hashes = Object.fromEntries(
        [
          'src/components/3d/softShadows.ts',
          'src/components/3d/lighting.ts',
          'e2e/sun-transition.visual.ts',
          'public/models/sauna.glb',
          'public/models/sauna-garden.glb',
          'public/models/irradiance.bin',
          'public/models/reflection.bin',
        ].map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]),
      );
      await info.attach('sun-transition', {
        contentType: 'application/json',
        body: JSON.stringify({
          mode,
          quality,
          browser: browser.version(),
          viewport: page.viewportSize(),
          hashes,
          dir: info.outputDir,
          samples,
          errors,
        }),
      });
    });
  }
}
