import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { timeFrames } from './gpu-timer';
import { rendererCaptureStyle } from './scene-capture';

// Diagnostic only: change the directional lookup, retaining all spot lights, light intensity,
// shadow maps and the unconditional receiver derivatives. Evening, or the night's moon with
// SUN_SHADOW_LIGHTING=night.
type SunMode = 'original' | 'hard' | 'off' | 'pcf' | 'before' | 'lite';
function patchSun(mode: SunMode) {
  const original = WebGL2RenderingContext.prototype.shaderSource;
  (window as unknown as { sunPatches: number }).sunPatches = 0;
  WebGL2RenderingContext.prototype.shaderSource = function (shader, source) {
    if (
      source.includes('float pcssNoise(') &&
      /suiSunShadow\( directLight\.color, directionalShadowMap\[/.test(source)
    ) {
      if (mode === 'before' || mode === 'lite') {
        // Always 16+24 (before the evening branch) or always the evening's lighter samples.
        source = source.replaceAll(
          'suiSunShadow( directLight.color, directionalShadowMap[',
          `${mode === 'before' ? 'getShadow' : 'suiGetShadowSunLite'}( directionalShadowMap[`,
        );
      } else if (mode !== 'original') {
        const helper = `
float suiDiagnosticSun(sampler2D map, vec2 size, float intensity, float bias, float radius, vec4 coord) {
${
  mode === 'off'
    ? 'return 1.0;'
    : `
  coord.xyz /= coord.w;
  if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z > 1.0) return 1.0;
  ${
    mode === 'pcf'
      ? `
  vec3 dx = suiShadowDx, dy = suiShadowDy;
  float det = dx.x * dy.y - dx.y * dy.x;
  vec2 slope = abs(det) > 1e-12 ? vec2(dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z) / det : vec2(0.0);
  slope = clamp(slope, -4.0, 4.0);
  // Bilinear interpolation of four depth comparisons, not of the stored depths.
  vec2 pixel = coord.xy * size - 0.5;
  vec2 base = floor(pixel), fraction = fract(pixel);
  float lit = 0.0;
  for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) {
    vec2 corner = vec2(float(x), float(y));
    vec2 uv = (base + corner + 0.5) / size;
    vec2 weight = mix(1.0 - fraction, fraction, corner);
    lit += weight.x * weight.y * step(coord.z + bias + dot(slope, uv - coord.xy), texture2D(map, uv).r);
  }
  return mix(1.0, lit, intensity);`
      : 'return mix(1.0, step(coord.z + bias, texture2D(map, coord.xy).r), intensity);'
  }`
}
}
`;
        source = source.replace('float pcssNoise(', helper + '\nfloat pcssNoise(');
        source = source.replace(
          /suiSunShadow\( directLight\.color, directionalShadowMap\[/g,
          'suiDiagnosticSun( directionalShadowMap[',
        );
      }
      (window as unknown as { sunPatches: number }).sunPatches++;
    }
    original.call(this, shader, source);
  };
}

type Camera = { render: string; camera: string; position: number[]; target: number[]; fov: number };
const reference: { cameras: Camera[] } = JSON.parse(readFileSync('e2e/fixtures/cycles-cameras.json', 'utf8'));
const stages = [
  ['sauna', '限界.. 水風呂へ 💧'],
  ['water', '外気浴へ 🍃'],
  ['totonou', null],
] as const;

test.use({ viewport: { width: 1200, height: 800 } });
const product = process.env.SUN_SHADOW_PRODUCT === '1';
const quality = process.env.SUN_SHADOW_QUALITY === 'standard' ? 'standard' : 'high';
const review = product || process.env.SUN_SHADOW_REVIEW === '1';
// The night compares the product moon (16+24) with the evening's 4+6 samples.
const lighting = process.env.SUN_SHADOW_LIGHTING === 'night' ? 'night' : 'evening';
if (lighting === 'night' && !product) throw new Error('SUN_SHADOW_LIGHTING=night needs SUN_SHADOW_PRODUCT=1');
const modes = product
  ? lighting === 'night'
    ? (['original', 'lite', 'original-repeat'] as const)
    : (['original', 'before', 'original-repeat'] as const)
  : review
    ? (['original', 'hard', 'pcf', 'original-repeat', 'pcf-repeat', 'hard-repeat', 'original-final'] as const)
    : (['original', 'hard', 'off', 'original-repeat'] as const);
for (const mode of modes) {
  test(`${lighting} sun shadow ${mode}`, async ({ page, browser }, info) => {
    test.setTimeout(480_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.addInitScript(timeFrames);
    await page.addInitScript(patchSun, mode.split('-')[0] as SunMode);
    const samples: object[] = [];
    const timingOnly = review && ['pcf-repeat', 'hard-repeat', 'original-final'].includes(mode);
    const passes = timingOnly ? [null] : [null, ['02.png', '03.png', '07.png'], ['01.png', '04.png', '05.png']];
    for (const [pass, renders] of passes.entries()) {
      if (renders) {
        await page.route('**/sauna.scene.json', async (route) => {
          const definition = await (await route.fetch()).json();
          for (const [index, [stage]] of stages.entries()) {
            const camera = reference.cameras.find((item) => item.render === renders[index])!;
            definition.views[stage] = { position: camera.position, target: camera.target, fov: camera.fov };
          }
          await route.fulfill({ json: definition });
        });
      }
      await page.goto('?view=3d');
      await page.getByRole('button', { name: '静かに入室する' }).click();
      const scene = page.locator('.sauna-3d-canvas');
      await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
      await page.getByLabel('3Dの画質').selectOption(quality);
      for (const [index, [stage, next]] of stages.entries()) {
        await expect(scene).toHaveAttribute('data-stage', stage);
        await page.getByLabel('3Dの時間帯').selectOption(lighting);
        await expect(scene).toHaveAttribute('data-lighting', lighting);
        await page.getByRole('button', { name: 'UI非表示', exact: true }).click();
        await page.waitForTimeout(1500);
        const file = renders ? `cycles-${renders[index]}` : `stage-${stage}.png`;
        await scene.locator('canvas').screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
        const times: number[] = [];
        const timer = await page.evaluate(() => Boolean((window as unknown as { suiTimer?: object }).suiTimer));
        if (pass === 0 && timer) {
          await page.evaluate(() => {
            const w = window as unknown as { suiGpuMs: number[]; suiMeasure: boolean };
            w.suiGpuMs = [];
            w.suiMeasure = true;
          });
          await page.waitForTimeout(4000);
          await page.evaluate(() => {
            (window as unknown as { suiMeasure: boolean }).suiMeasure = false;
          });
          await page.waitForTimeout(1000);
          times.push(...(await page.evaluate(() => (window as unknown as { suiGpuMs: number[] }).suiGpuMs)));
          expect(times.length).toBeGreaterThan(20);
        }
        samples.push({
          file,
          stage,
          timer,
          times,
          metrics: await scene.evaluate((e) => ({ ...(e as HTMLElement).dataset })),
        });
        if (review && pass === 0 && !timingOnly) {
          const canvas = scene.locator('canvas');
          const frame = () =>
            page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
          const capture = async (suffix: string) => {
            await frame();
            const file = `${stage}-${suffix}.png`;
            await canvas.screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
            samples.push({ file, stage, timer: false, times: [], metrics: {} });
          };
          // Small drags measure the change of candidate-minus-original error between frames.
          for (let step = 0; step <= 8; step++) {
            if (step > 0) {
              await page.mouse.move(600, 400);
              await page.mouse.down();
              await page.mouse.move(601, 400);
              await page.mouse.up();
            }
            await capture(`move-${step}`);
          }
          await page.mouse.move(600, 400);
          await page.mouse.down();
          await page.mouse.move(592, 400);
          await page.mouse.up();
          // Same 8 headings x 3 pitches as the full-surround survey, with DOM effects excluded.
          for (let heading = 0; heading < 8; heading++) {
            for (const pitch of [0, -0.45, 0.45]) {
              if (pitch) {
                await page.mouse.move(600, 400);
                await page.mouse.down();
                await page.mouse.move(600, 400 + pitch / 0.004);
                await page.mouse.up();
              }
              await capture(`survey-${heading}-${pitch}`);
              if (pitch) {
                await page.mouse.move(600, 400);
                await page.mouse.down();
                await page.mouse.move(600, 400 - pitch / 0.004);
                await page.mouse.up();
              }
            }
            await page.mouse.move(600, 400);
            await page.mouse.down();
            await page.mouse.move(600 + Math.PI / 4 / 0.004, 400);
            await page.mouse.up();
          }
        }
        await page.getByRole('button', { name: 'UI表示', exact: true }).click();
        if (next) await page.getByRole('button', { name: next, exact: true }).click();
      }
      expect(await page.evaluate(() => (window as unknown as { sunPatches: number }).sunPatches)).toBeGreaterThan(0);
      await page.unroute('**/sauna.scene.json');
    }
    expect(errors).toEqual([]);
    const hashes = Object.fromEntries(
      [
        'src/components/3d/softShadows.ts',
        'e2e/sun-shadow.gpu.ts',
        'public/models/sauna.glb',
        'public/models/sauna-garden.glb',
        'public/models/irradiance.bin',
        'public/models/reflection.bin',
        'e2e/fixtures/cycles-cameras.json',
      ].map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]),
    );
    await info.attach('sun-shadow', {
      contentType: 'application/json',
      body: JSON.stringify(
        {
          mode,
          lighting,
          browser: browser.version(),
          viewport: page.viewportSize(),
          quality,
          reducedMotion: true,
          dir: info.outputDir,
          samples,
          errors,
          hashes,
        },
        null,
        2,
      ),
    });
  });
}
