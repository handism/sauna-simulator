import { expect, test } from '@playwright/test';
import { chooseSceneSetting, switchSceneMode } from './settings-controls';

for (const warmup of ['off', 'split']) {
  for (const timing of ['initial', 'later']) {
    test(`shader link failure during ${timing} ${warmup} rendering preserves 2D and retry`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript((initial) => {
        const state = { armed: initial, injected: 0 };
        Object.assign(window, { shaderFailure: state });
        const source = WebGL2RenderingContext.prototype.shaderSource;
        WebGL2RenderingContext.prototype.shaderSource = function (shader, code) {
          if (state.armed && this.getShaderParameter(shader, this.SHADER_TYPE) === this.FRAGMENT_SHADER) {
            state.injected++;
            code += '\nINVALID_SHADER_DIAGNOSTIC';
          }
          return source.call(this, shader, code);
        };
      }, timing === 'initial');
      await page.goto(`?view=3d&warmup=${warmup}`);
      await page.getByRole('button', { name: '音なしで入室する' }).click();
      const scene = page.locator('.sauna-3d-canvas');
      if (timing === 'later') {
        await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
        await page.evaluate(() => {
          (window as any).shaderFailure.armed = true;
        });
        // A previously unseen material program during a quality change.
        await chooseSceneSetting(page, '3Dの画質', 'low');
      }
      await expect(page.getByRole('status')).toContainText('2Dで続けています', { timeout: 30_000 });
      await expect(scene).toHaveCount(0);
      expect(await page.evaluate(() => (window as any).shaderFailure.injected)).toBeGreaterThan(0);
      await page.evaluate(() => {
        (window as any).shaderFailure.armed = false;
      });
      await expect(page.locator('.sound-control')).toHaveAttribute('data-muted', 'true');
      await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
      await expect(page.getByRole('heading', { name: '水風呂', exact: true })).toBeVisible();
      await switchSceneMode(page, '2Dに切り替え');
      await switchSceneMode(page, '3Dを試す');
      await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
      await expect(scene).toHaveAttribute('data-stage', 'water');
      expect(errors).toEqual([]);
    });
  }
}
