import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { timeFrames } from './gpu-timer';
import { rendererCaptureStyle } from './scene-capture';

// Diagnostic only: change the directional lookup, retaining all spot lights, light intensity,
// shadow maps and the unconditional receiver derivatives. Only evening is evaluated here.
function patchSun(mode: 'original' | 'hard' | 'off') {
  const original = WebGL2RenderingContext.prototype.shaderSource;
  (window as unknown as { sunPatches: number }).sunPatches = 0;
  WebGL2RenderingContext.prototype.shaderSource = function (shader, source) {
    if (source.includes('float pcssNoise(') && /getShadow\( directionalShadowMap\[/.test(source)) {
      if (mode !== 'original') {
        const helper = `
float suiDiagnosticSun(sampler2D map, vec2 size, float intensity, float bias, float radius, vec4 coord) {
${
  mode === 'off'
    ? 'return 1.0;'
    : `
  coord.xyz /= coord.w;
  if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z > 1.0) return 1.0;
  return mix(1.0, step(coord.z + bias, texture2D(map, coord.xy).r), intensity);`
}
}
`;
        source = source.replace('float pcssNoise(', helper + '\nfloat pcssNoise(');
        source = source.replace(/getShadow\( directionalShadowMap\[/g, 'suiDiagnosticSun( directionalShadowMap[');
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
for (const mode of ['original', 'hard', 'off', 'original-repeat'] as const) {
  test(`evening sun shadow ${mode}`, async ({ page, browser }, info) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.addInitScript(timeFrames);
    await page.addInitScript(patchSun, mode === 'original-repeat' ? 'original' : mode);
    const samples: object[] = [];
    for (const [pass, renders] of [null, ['02.png', '03.png', '07.png'], ['01.png', '04.png', '05.png']].entries()) {
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
      await page.getByLabel('3Dの画質').selectOption('high');
      for (const [index, [stage, next]] of stages.entries()) {
        await expect(scene).toHaveAttribute('data-stage', stage);
        await page.getByLabel('3Dの時間帯').selectOption('evening');
        await expect(scene).toHaveAttribute('data-lighting', 'evening');
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
          browser: browser.version(),
          viewport: page.viewportSize(),
          quality: 'high',
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
