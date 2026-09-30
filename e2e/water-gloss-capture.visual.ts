import { expect, test } from '@playwright/test';
import { rendererCaptureStyle } from './scene-capture';

// The tiles' own highlight of the lounge dusk fill under the water (waterBottom.ts suiWetSpecular),
// in scene-linear light, for scripts/summarize_water_gloss_capture.py to compare with the Cycles
// tile gloss of scripts/diagnose_water_gloss_scene.py. Browser-only rewrites, as shadow-variants.ts:
// - the HDR output pass (hdrOutput.ts) writes the linear buffer times LINEAR_SCALE instead of the
//   AgX view (no exposure), which the canvas then encodes as sRGB;
// - `off` drops the dusk fill's suiWetSpecular call (index 1 of wetGlossLights()) and, where the
//   build has them, its images in the water's sides (suiWetImage).
// Each variant is its own page load (the programs are compiled once); `on` is captured twice to
// measure the reload's own difference. Evening only, standard quality, reduced motion (still water).
const LINEAR_SCALE = 0.5;
const VARIANTS = ['on', 'off', 'on-again'] as const;
const VIEWS = [
  [1, 'down'],
  [2, 'level'],
] as const;

function patchGloss({ off, scale }: { off: boolean; scale: number }) {
  const original = WebGL2RenderingContext.prototype.shaderSource;
  const patches = { output: 0, gloss: 0, images: 0 };
  (window as unknown as { glossPatches: typeof patches }).glossPatches = patches;
  const replace = (source: string, text: string, by: string) => {
    if (!source.includes(text)) throw new Error(`gloss diagnostic no longer matches: ${text}`);
    return source.replace(text, by);
  };
  const call = /suiWetSpecular\( 1, suiWetColor1, suiWetDirection1, [^;]*;/;
  const images = 'suiWetSpecular( suiLight, suiImageLight.color * suiReflectance, ';
  WebGL2RenderingContext.prototype.shaderSource = function (shader, source) {
    if (source.includes('uniform sampler2D tScene;')) {
      source = replace(source, 'return AgXToneMapping( color );', 'return color;');
      source = replace(
        source,
        'gl_FragColor = texture2D( tScene, vUv );',
        `gl_FragColor = texture2D( tScene, vUv ); gl_FragColor.rgb *= ${scale.toFixed(4)};`,
      );
      patches.output++;
    }
    if (off && call.test(source)) {
      source = source.replace(call, '');
      patches.gloss++;
      if (source.includes(images)) {
        source = source.replace(
          images,
          'suiWetSpecular( suiLight, suiImageLight.color * suiReflectance * float( suiLight != 1 ), ',
        );
        patches.images++;
      }
    }
    return original.call(this, shader, source);
  };
}

test.describe.configure({ mode: 'serial' });

for (const variant of VARIANTS)
  test(`capture the dusk fill tile gloss in linear light (${variant})`, async ({ page }, info) => {
    const samples: object[] = [];
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(patchGloss, { off: variant === 'off', scale: LINEAR_SCALE });
    await page.goto('?view=3d');
    await page.getByRole('button', { name: '静かに入室する' }).click();
    const scene = page.locator('.sauna-3d-canvas');
    const canvas = scene.locator('canvas');
    await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 20_000 });
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 20_000 });
    await page.getByLabel('3Dの画質').selectOption('standard');
    await page.getByRole('button', { name: '限界.. 水風呂へ 💧', exact: true }).click();
    await expect(scene).toHaveAttribute('data-stage', 'water');
    await page.getByRole('button', { name: 'UI非表示', exact: true }).click();
    await page.getByLabel('3Dの時間帯').selectOption('evening');
    await expect(scene).toHaveAttribute('data-lighting', 'evening');
    await page.waitForTimeout(1200);
    const press = async (key: string, count: number) => {
      await scene.focus();
      for (let n = 0; n < count; n++) await page.keyboard.press(key);
    };
    for (const [heading, pitch] of VIEWS) {
      // The views of stage-compare.visual.ts.
      await press('ArrowRight', 10 * heading);
      await press('ArrowDown', 32);
      if (pitch === 'level') await press('ArrowUp', 14);
      await scene.blur();
      await page.waitForTimeout(300);
      const file = `gloss-${variant}-${heading}-${pitch}.png`;
      await canvas.screenshot({ path: info.outputPath(file), type: 'png', style: rendererCaptureStyle });
      samples.push({ file, variant, heading, pitch, lighting: 'evening' });
      await press('ArrowLeft', 10 * heading);
    }
    const patches = await page.evaluate(() => (window as unknown as { glossPatches: object }).glossPatches);
    samples.push({ variant, patches });
    expect(errors).toEqual([]);
    const counts = patches as { output: number; gloss: number };
    expect(counts.output).toBeGreaterThan(0);
    if (variant === 'off') expect(counts.gloss).toBeGreaterThan(0);
    await info.attach('water-gloss-capture', {
      contentType: 'application/json',
      body: JSON.stringify({ scale: LINEAR_SCALE, samples }, null, 2),
    });
  });
