import { expect, test } from '@playwright/test';
import { chooseSceneSetting } from './settings-controls';

test('3D autumn persists, changes the outdoor view and restores summer without reloading models', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const models: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().endsWith('.glb')) models.push(request.url());
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('?view=3d&frameRate=full&resolution=fixed');
  await chooseSceneSetting(page, '3Dの季節', 'autumn');
  await chooseSceneSetting(page, '3Dの時間帯', 'day');
  await page.getByRole('button', { name: '音なしで入室する' }).click();
  const scene = page.locator('.sauna-3d-canvas');
  const canvas = scene.locator('canvas');
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 40_000 });
  await expect(scene).toHaveAttribute('data-season', 'autumn');
  await expect(scene).toHaveAttribute('data-season-materials', /[1-9]\d*/);
  await canvas.evaluate((element) => element.setAttribute('data-original-canvas', 'yes'));
  await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
  await expect(scene).toHaveAttribute('data-stage', 'water');
  await page.getByRole('button', { name: '外気浴へ', exact: true }).click();
  await expect(scene).toHaveAttribute('data-stage', 'totonou');
  await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
  await page.waitForTimeout(700);
  const autumn = await canvas.screenshot({ path: info.outputPath('autumn.png') });
  await chooseSceneSetting(page, '3Dの季節', 'summer');
  await expect(scene).toHaveAttribute('data-season', 'summer');
  await page.waitForTimeout(700);
  const summer = await canvas.screenshot({ path: info.outputPath('summer.png') });
  expect(autumn.equals(summer)).toBe(false);
  await chooseSceneSetting(page, '3Dの季節', 'autumn');
  await expect(scene).toHaveAttribute('data-season', 'autumn');
  await expect(canvas).toHaveAttribute('data-original-canvas', 'yes');
  expect(models.filter((url) => url.endsWith('/sauna.glb'))).toHaveLength(1);
  expect(models.filter((url) => url.endsWith('/sauna-garden.glb'))).toHaveLength(1);
  expect(await page.evaluate(() => localStorage.getItem('sui-season'))).toBe('autumn');
  expect(errors).toEqual([]);
});
