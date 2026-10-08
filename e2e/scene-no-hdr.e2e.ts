import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chooseSceneSetting, switchSceneMode } from './settings-controls';

// Simulate missing float color buffers on desktop Chrome. This exercises the real LDR
// renderer, but does not establish compatibility or performance on non-HDR hardware.
for (const quality of ['low', 'standard', 'high']) {
  test(`split request without HDR renders and recovers at ${quality} quality`, async ({ page, browser }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript((quality) => {
      const getExtension: (this: WebGL2RenderingContext, name: string) => any =
        WebGL2RenderingContext.prototype.getExtension;
      WebGL2RenderingContext.prototype.getExtension = function (name: string) {
        return name === 'EXT_color_buffer_float' ? null : getExtension.call(this, name);
      };
      const supported = WebGL2RenderingContext.prototype.getSupportedExtensions;
      WebGL2RenderingContext.prototype.getSupportedExtensions = function () {
        return supported.call(this)?.filter((name) => name !== 'EXT_color_buffer_float') ?? null;
      };
      localStorage.setItem('sui-quality', quality);
      localStorage.setItem('sui-lighting-mode', 'day');
      localStorage.setItem('sui-guide-dismissed', 'yes');
    }, quality);
    await page.goto('?view=3d&warmup=split&frameRate=full&resolution=fixed');
    await page.getByRole('button', { name: '音なしで入室する' }).click();
    const scene = page.locator('.sauna-3d-canvas');
    const ready = async () => {
      await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 30_000 });
      await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
      await expect(scene).toHaveAttribute('data-warmup', 'off');
      await expect(scene).toHaveAttribute('data-temporal', 'off');
      await expect(scene).toHaveAttribute('data-quality', quality);
    };
    await ready();
    const original = await scene.locator('canvas').elementHandle();
    const capabilities = await original!.evaluate((canvas: HTMLCanvasElement) => {
      const gl = canvas.getContext('webgl2')!;
      return { float: !!gl.getExtension('EXT_color_buffer_float'), attributes: gl.getContextAttributes() };
    });
    expect(capabilities.float).toBe(false);
    expect(capabilities.attributes?.depth).toBe(true);
    expect(capabilities.attributes?.antialias).toBe(true);
    const samples = [];
    for (const [stage, button, lighting, time] of [
      ['sauna', '', 'day', '0.000'],
      ['water', '水風呂へ', 'evening', '1.000'],
      ['totonou', '外気浴へ', 'night', '2.000'],
    ]) {
      if (button) await page.getByRole('button', { name: button, exact: true }).click();
      await expect(scene).toHaveAttribute('data-stage', stage);
      await chooseSceneSetting(page, '3Dの時間帯', lighting);
      await expect(scene).toHaveAttribute('data-time-of-day', time);
      await expect(scene).toHaveAttribute('data-draw-calls', /^[1-9]\d*$/);
      await info.attach(`${quality}-${stage}`, { body: await scene.screenshot(), contentType: 'image/png' });
      samples.push(await scene.evaluate((element) => ({ ...(element as HTMLElement).dataset })));
    }
    expect(await original!.evaluate((canvas) => canvas === document.querySelector('.sauna-3d-canvas canvas'))).toBe(
      true,
    );
    expect(
      await original!.evaluate((canvas: HTMLCanvasElement) => {
        const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
        extension?.loseContext();
        return !!extension;
      }),
    ).toBe(true);
    await expect(page.getByRole('status')).toContainText('2Dで続けています');
    await expect(scene).toHaveCount(0);
    await page.getByRole('button', { name: 'もう一度サウナへ', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'サウナルーム' })).toBeVisible();
    await expect(page.locator('.sound-control')).toHaveAttribute('data-muted', 'true');
    await switchSceneMode(page, '2Dに切り替え');
    await switchSceneMode(page, '3Dを試す');
    await ready();
    await expect(scene).toHaveAttribute('data-stage', 'sauna');
    await expect(scene).toHaveAttribute('data-time-of-day', '2.000');
    await expect(page.locator('.sound-control')).toHaveAttribute('data-muted', 'true');
    expect(errors).toEqual([]);
    const hashes = Object.fromEntries(
      [
        'e2e/scene-no-hdr.e2e.ts',
        'e2e/settings-controls.ts',
        'playwright.config.ts',
        'src/components/3d/SaunaScene.tsx',
        'src/components/3d/hdrOutput.ts',
        'src/components/3d/sceneWarmup.ts',
        'src/components/SceneMode.tsx',
        'public/models/sauna.glb',
        'public/models/sauna-garden.glb',
        'bun.lock',
      ].map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]),
    );
    await info.attach('no-hdr', {
      contentType: 'application/json',
      body: JSON.stringify({
        quality,
        browser: browser.version(),
        capabilities,
        samples,
        errors,
        hashes,
        recovered: await scene.evaluate((element) => ({ ...(element as HTMLElement).dataset })),
      }),
    });
  });
}
