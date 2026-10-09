import { chooseSceneSetting, switchSceneMode } from './settings-controls';
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });

test('narrow controls, keyboard look and resize preserve the loaded scene', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('?view=3d');
  await page.getByRole('button', { name: '音なしで入室する' }).click();
  const scene = page.locator('.sauna-3d-canvas');
  const canvas = scene.locator('canvas');
  await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 20_000 });
  const original = await canvas.elementHandle();
  await chooseSceneSetting(page, '3Dの画質', 'low');
  await expect(scene).toHaveAttribute('data-quality', 'low');
  await chooseSceneSetting(page, '3Dの時間帯', 'day');
  await expect(scene).toHaveAttribute('data-lighting', 'day');

  await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
  await scene.focus();
  // Reduced motion leaves the idle scene static, so a changed canvas image
  // demonstrates keyboard look actually changes the rendered view.
  const before = await canvas.screenshot();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false);
  await page.getByRole('button', { name: '操作を表示', exact: true }).click();

  for (const [button, stage] of [
    ['水風呂へ', 'water'],
    ['外気浴へ', 'totonou'],
    ['もう一度サウナへ', 'sauna'],
  ]) {
    const next = page.getByRole('button', { name: button, exact: true });
    await expect(next).toBeInViewport({ ratio: 1 });
    await next.click();
    await expect(scene).toHaveAttribute('data-stage', stage);
  }
  for (const size of [
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await expect
      .poll(() =>
        canvas.evaluate((element) => {
          const rendered = element as HTMLCanvasElement;
          return { width: rendered.width, height: rendered.height };
        }),
      )
      .toEqual(size);
    expect(await original!.evaluate((element) => element === document.querySelector('.sauna-3d-canvas canvas'))).toBe(
      true,
    );
    await expect(page.locator('.display-settings > summary')).toBeInViewport({ ratio: 1 });
  }
  await page.screenshot({ path: info.outputPath('narrow-sauna.png') });
  await switchSceneMode(page, '2Dに切り替え');
  await expect(scene).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'サウナルーム' })).toBeVisible();
  expect(errors).toEqual([]);
});
