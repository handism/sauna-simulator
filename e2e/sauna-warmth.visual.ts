import { expect, test } from '@playwright/test';
import { chooseSceneSetting } from './settings-controls';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';

// The sauna's default view, the stove and the bench side by day, dusk and night: the pail's water,
// the heater's ember glow and the room's dusk exposure (docs/3d-qa/sauna-warmth/). WARMTH_RUN labels
// the run, WARMTH_LIGHTS picks the times of day.
const run = process.env.WARMTH_RUN ?? 'now';
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
test(`sauna warmth ${run}`, async ({ page }, info) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('?sound=off&view=3d&quality=standard&resolution=fixed&frameRate=full');
  await page.getByRole('button', { name: '入室する', exact: true }).click();
  const scene = page.locator('.sauna-3d-canvas');
  const canvas = scene.locator('canvas');
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 120_000 });
  await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
  const press = async (key: string, times: number) => {
    for (let i = 0; i < times; i++) await page.keyboard.press(key);
  };
  for (const lighting of (process.env.WARMTH_LIGHTS ?? 'day,evening,night').split(',')) {
    await chooseSceneSetting(page, '3Dの時間帯', lighting);
    await expect(scene).toHaveAttribute('data-lighting', lighting);
    for (const [name, yaw, pitch] of [
      ['front', 0, 0],
      ['stove', 0, -3],
      ['bench', -5, -2],
    ] as const) {
      await scene.focus();
      await press(yaw < 0 ? 'ArrowLeft' : 'ArrowRight', Math.abs(yaw));
      await press(pitch < 0 ? 'ArrowDown' : 'ArrowUp', Math.abs(pitch));
      await settleRenderer(page);
      await canvas.screenshot({ path: info.outputPath(`${lighting}-${name}.png`), style: rendererCaptureStyle });
      await press(yaw < 0 ? 'ArrowRight' : 'ArrowLeft', Math.abs(yaw));
      await press(pitch < 0 ? 'ArrowUp' : 'ArrowDown', Math.abs(pitch));
    }
  }
  expect(errors).toEqual([]);
});
