import { chooseSceneSetting } from './settings-controls';
import { expect, test } from '@playwright/test';

// Review captures of the rain's approximation (lighting.ts, rain.ts) beside the clear sky, at each
// stage's entry view and time of day. Not golden images; reduced motion holds the drops still.
test('capture the rain beside the clear sky', async ({ page }, info) => {
  test.setTimeout(170_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('?view=3d&frameRate=full');
  await page.getByRole('button', { name: '音なしで入室する' }).click();
  const scene = page.locator('.sauna-3d-canvas');
  const canvas = scene.locator('canvas');
  await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 20_000 });
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 20_000 });
  const stages = [
    ['sauna', '水風呂へ'],
    ['water', '外気浴へ'],
    ['totonou', 'もう一度サウナへ'],
  ] as const;
  for (const [stage, next] of stages) {
    await expect(scene).toHaveAttribute('data-stage', stage);
    await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
    await page.waitForTimeout(1200);
    for (const lighting of ['day', 'evening', 'night']) {
      await chooseSceneSetting(page, '3Dの時間帯', lighting);
      for (const weather of ['clear', 'rain']) {
        await chooseSceneSetting(page, '天気', weather);
        await expect(scene).toHaveAttribute('data-rain', weather === 'rain' ? '1.000' : '0.000');
        await page.waitForTimeout(300);
        await canvas.screenshot({
          path: info.outputPath(`${stage}-${lighting}-${weather}.jpg`),
          type: 'jpeg',
          quality: 88,
        });
      }
    }
    await page.getByRole('button', { name: '操作を表示', exact: true }).click();
    await page.getByRole('button', { name: next, exact: true }).click();
  }
  expect(errors).toEqual([]);
});
