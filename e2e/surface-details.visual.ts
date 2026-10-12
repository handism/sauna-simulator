import { expect, test } from '@playwright/test';
import { chooseSceneSetting } from './settings-controls';
import { rendererCaptureStyle } from './scene-capture';

// Near-surface review artifacts; no claim of golden-image agreement or GPU performance.
test.use({ deviceScaleFactor: 2 });
test('deck and stone close views render through lighting changes', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('?view=3d&resolution=fixed&frameRate=full');
  await chooseSceneSetting(page, '3Dの画質', 'high');
  await chooseSceneSetting(page, '3Dの時間帯', 'day');
  await page.getByRole('button', { name: '音なしで入室する' }).click();
  const scene = page.locator('.sauna-3d-canvas');
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 40_000 });
  await expect(scene).toHaveAttribute('data-quality', 'high');
  const canvas = scene.locator('canvas');
  for (const [stage, next] of [
    ['sauna', '水風呂へ'],
    ['water', '外気浴へ'],
    ['totonou', null],
  ] as const) {
    await expect(scene).toHaveAttribute('data-stage', stage);
    await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
    await scene.focus();
    for (let i = 0; i < 32; i++) await page.keyboard.press('ArrowDown');
    for (const lighting of ['day', 'evening', 'night']) {
      await chooseSceneSetting(page, '3Dの時間帯', lighting);
      await expect(scene).toHaveAttribute('data-lighting', lighting);
      await page.waitForTimeout(1200);
      await canvas.screenshot({ path: info.outputPath(`${stage}-${lighting}-down.png`), style: rendererCaptureStyle });
    }
    await page.getByRole('button', { name: '操作を表示', exact: true }).click();
    if (next) await page.getByRole('button', { name: next, exact: true }).click();
  }
  expect(errors).toEqual([]);
});
