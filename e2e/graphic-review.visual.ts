import { expect, test } from '@playwright/test';
import { chooseSceneSetting } from './settings-controls';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';

// One run of a before/after still comparison of the 2026-10-28 graphic review: the lounge light in the
// sauna's window and on the pool floor, the winter evergreens, the autumn ferns, the mid-ground crowns
// at dusk, the courtyard's plaster wall, the winter snowfield and the plunge side seen from the sauna
// at night. The run label comes from REVIEW_RUN.
const run = process.env.REVIEW_RUN ?? 'after1';
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
test(`graphic review ${run}`, async ({ page, browser }, info) => {
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
  const look = async (yaw: number, pitch: number, shoot: () => Promise<void>) => {
    await scene.focus();
    const press = async (key: string, times: number) => {
      for (let i = 0; i < times; i++) await page.keyboard.press(key);
    };
    await press(yaw < 0 ? 'ArrowLeft' : 'ArrowRight', Math.abs(yaw));
    await press(pitch < 0 ? 'ArrowDown' : 'ArrowUp', Math.abs(pitch));
    await shoot();
    await press(yaw < 0 ? 'ArrowRight' : 'ArrowLeft', Math.abs(yaw));
    await press(pitch < 0 ? 'ArrowUp' : 'ArrowDown', Math.abs(pitch));
  };
  // [season, lighting, view name, yaw, pitch] per stage.
  const shots = {
    sauna: [
      ['summer', 'evening', 'front', 0, 0],
      ['summer', 'night', 'front', 0, 0],
      ['winter', 'day', 'front', 0, 0],
    ],
    water: [
      ['summer', 'evening', 'front', 0, 0],
      ['summer', 'evening', 'left', -9, 0],
      ['summer', 'night', 'left', -9, 0],
      ['winter', 'day', 'front', 0, 0],
    ],
    totonou: [
      ['summer', 'day', 'left', -9, 0],
      ['summer', 'evening', 'front', 0, 0],
      ['summer', 'evening', 'right', 9, 0],
      ['summer', 'night', 'right', 9, 0],
      ['summer', 'night', 'left', -9, 0],
      ['autumn', 'day', 'front', 0, 0],
      ['autumn', 'day', 'left', -9, 0],
      ['winter', 'day', 'front', 0, 0],
      ['winter', 'day', 'right', 9, 0],
    ],
  } as const;
  for (const [stage, next] of [
    ['sauna', '水風呂へ'],
    ['water', '外気浴へ'],
    ['totonou', null],
  ] as const) {
    await expect(scene).toHaveAttribute('data-stage', stage);
    await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
    for (const [season, lighting, name, yaw, pitch] of shots[stage]) {
      await chooseSceneSetting(page, '3Dの季節', season);
      await expect(scene).toHaveAttribute('data-season', season);
      await chooseSceneSetting(page, '3Dの時間帯', lighting);
      await expect(scene).toHaveAttribute('data-lighting', lighting);
      await look(yaw, pitch, () => capture(`${stage}-${season}-${lighting}-${name}.png`));
    }
    await chooseSceneSetting(page, '3Dの季節', 'summer');
    await chooseSceneSetting(page, '3Dの時間帯', 'day');
    await expect(scene).toHaveAttribute('data-lighting', 'day');
    await page.getByRole('button', { name: '操作を表示', exact: true }).click();
    if (next) await page.getByRole('button', { name: next, exact: true }).click();
  }
  expect(errors).toEqual([]);
  await info.attach('graphic-review', {
    contentType: 'application/json',
    body: JSON.stringify({ run, browser: browser.version(), errors }),
  });
});
