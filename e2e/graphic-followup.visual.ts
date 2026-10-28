import { expect, test } from '@playwright/test';
import { chooseSceneSetting } from './settings-controls';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';

// One run of a before/after still comparison of the 2026-10-28 follow-up: the far forest's band
// between the winter evergreens, the plunge's reflections at dusk and night, and the sauna's steam
// against the glass after a löyly. The run label comes from REVIEW_RUN.
const run = process.env.REVIEW_RUN ?? 'after1';
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
test(`graphic follow-up ${run}`, async ({ page }, info) => {
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
  const capture = async (file: string) => {
    await settleRenderer(page);
    await canvas.screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
  };
  const press = async (key: string, times: number) => {
    for (let i = 0; i < times; i++) await page.keyboard.press(key);
  };
  const look = async (yaw: number, pitch: number, shoot: () => Promise<void>) => {
    await scene.focus();
    await press(yaw < 0 ? 'ArrowLeft' : 'ArrowRight', Math.abs(yaw));
    await press(pitch < 0 ? 'ArrowDown' : 'ArrowUp', Math.abs(pitch));
    await shoot();
    await press(yaw < 0 ? 'ArrowRight' : 'ArrowLeft', Math.abs(yaw));
    await press(pitch < 0 ? 'ArrowUp' : 'ArrowDown', Math.abs(pitch));
  };
  const setLook = async (season: string, lighting: string) => {
    await chooseSceneSetting(page, '3Dの季節', season);
    await expect(scene).toHaveAttribute('data-season', season);
    await chooseSceneSetting(page, '3Dの時間帯', lighting);
    await expect(scene).toHaveAttribute('data-lighting', lighting);
  };

  // The sauna: the steam two löyly in, looking ahead and to the glass.
  await expect(scene).toHaveAttribute('data-stage', 'sauna');
  const lightings = ['day', 'evening', 'night'] as const;
  await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
  for (const lighting of lightings) {
    await setLook('summer', lighting);
    await look(0, 0, () => capture(`sauna-${lighting}-front-clear.png`));
  }
  await page.getByRole('button', { name: '操作を表示', exact: true }).click();
  // Each time of day two löyly in (the vapor builds up over the three, the same in every run).
  for (const lighting of lightings) {
    await setLook('summer', lighting);
    const loyly = page.getByRole('button', { name: /ロウリュ/ }).first();
    await loyly.click();
    await page.waitForTimeout(1500);
    await loyly.click();
    await page.waitForTimeout(4000);
    await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
    await look(0, 0, () => capture(`sauna-${lighting}-front-steam.png`));
    await look(-12, 0, () => capture(`sauna-${lighting}-left-steam.png`));
    await look(-12, 10, () => capture(`sauna-${lighting}-up-steam.png`));
    await page.getByRole('button', { name: '操作を表示', exact: true }).click();
  }
  await setLook('summer', 'day');
  await page.getByRole('button', { name: '水風呂へ', exact: true }).click();

  // The plunge at dusk and night, then the forest at the level horizon.
  await expect(scene).toHaveAttribute('data-stage', 'water');
  await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
  for (const [lighting, name, yaw, pitch] of [
    ['evening', 'front', 0, 0],
    ['evening', 'left', -9, 0],
    ['evening', 'down', 0, -6],
    ['night', 'front', 0, 0],
    ['night', 'left', -9, 0],
    ['day', 'front', 0, 0],
  ] as const) {
    await setLook('summer', lighting);
    await look(yaw, pitch, () => capture(`water-${lighting}-${name}.png`));
  }
  // The level horizon (as forest-leaf-masses.visual.ts): to the lower limit, then up.
  const level = async () => {
    await scene.focus();
    await press('ArrowDown', 32);
    await press('ArrowUp', 14);
  };
  await level();
  for (const lighting of ['day', 'evening']) {
    await setLook('winter', lighting);
    await look(60, 0, () => capture(`water-winter-${lighting}-right60.png`));
    await look(20, 0, () => capture(`water-winter-${lighting}-right20.png`));
  }
  await setLook('summer', 'day');
  await page.getByRole('button', { name: '操作を表示', exact: true }).click();
  await page.getByRole('button', { name: '外気浴へ', exact: true }).click();
  await expect(scene).toHaveAttribute('data-stage', 'totonou');
  await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
  await level();
  for (const lighting of ['day', 'evening']) {
    await setLook('winter', lighting);
    for (const yaw of [-30, 30, 60]) await look(yaw, 0, () => capture(`totonou-winter-${lighting}-${yaw}.png`));
  }
  expect(errors).toEqual([]);
});
