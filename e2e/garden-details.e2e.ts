import { expect, test } from '@playwright/test';
import { chooseSceneSetting } from './settings-controls';

test('garden accents survive seasons, weather, motion preferences and stage changes', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('?sound=off&view=3d&resolution=fixed');
  await chooseSceneSetting(page, '3Dの時間帯', 'day');
  await page.getByRole('button', { name: '入室する', exact: true }).click();
  const scene = page.locator('.sauna-3d-canvas');
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 40_000 });
  await expect(scene).toHaveAttribute('data-garden-details', 'ready');
  const canvas = scene.locator('canvas');
  await canvas.evaluate((el) => el.setAttribute('data-original', 'yes'));
  await canvas.screenshot({ path: info.outputPath('sauna-day.png') });
  await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
  await expect(scene).toHaveAttribute('data-stage', 'water');
  await page.waitForTimeout(1000);
  await canvas.screenshot({ path: info.outputPath('water-day.png') });
  await page.getByRole('button', { name: '外気浴へ', exact: true }).click();
  await expect(scene).toHaveAttribute('data-stage', 'totonou');
  await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
  for (const season of ['summer', 'autumn', 'winter', 'spring']) {
    await chooseSceneSetting(page, '3Dの季節', season);
    await expect(scene).toHaveAttribute('data-season', season);
    await page.waitForTimeout(1000);
    await canvas.screenshot({ path: info.outputPath(`totonou-${season}.png`) });
  }
  for (const time of ['evening', 'night']) {
    await chooseSceneSetting(page, '3Dの時間帯', time);
    await page.waitForTimeout(1000);
    await canvas.screenshot({ path: info.outputPath(`totonou-${time}.png`) });
  }
  await chooseSceneSetting(page, '天気', 'rain');
  await expect(scene).toHaveAttribute('data-weather', 'rain');
  await canvas.screenshot({ path: info.outputPath('totonou-rain.png') });
  await chooseSceneSetting(page, '天気', 'clear');
  await chooseSceneSetting(page, '3Dの時間帯', 'day');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(2000);
  await expect(canvas).toHaveAttribute('data-original', 'yes');
  await expect(scene).toHaveAttribute('data-garden-details', 'ready');
  expect(errors).toEqual([]);
});
