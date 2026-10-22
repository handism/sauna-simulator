import { expect, test } from '@playwright/test';
import { chooseSceneSetting } from './settings-controls';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';

// One run of a before/after still comparison of the 2026-10-22 look fixes (plunge wall band and
// spout ring, night lounge glow on the water, winter/autumn far forest, the bowl's woodland card,
// sandal straps, the night stove stones and glass, the bench gaps, the plunge back wall, the deck
// weathering). The run label comes from LOOK_RUN.
const run = process.env.LOOK_RUN ?? 'after1';
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
test(`look fixes ${run}`, async ({ page, browser }, info) => {
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
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
  const captures: { file: string; metrics: Record<string, string | undefined> }[] = [];
  const capture = async (file: string) => {
    await settleRenderer(page);
    await canvas.screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
    captures.push({ file, metrics: await scene.evaluate((e) => ({ ...(e as HTMLElement).dataset })) });
  };
  const look = async (yaw: number, pitch: number, shoot: () => Promise<void>) => {
    // Selecting a setting focuses the settings menu: return input to the look surface.
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
  // Each view: [name, left(-)/right(+) key presses, up(+)/down(-) key presses] from the stage view.
  const views = {
    sauna: [
      ['front', 0, 0],
      ['down', 0, -4],
      ['glass', -9, 0],
    ],
    water: [
      ['front', 0, 0],
      ['down', 0, -4],
      ['back', 20, -3],
    ],
    totonou: [
      ['front', 0, 0],
      ['down', 0, -4],
      ['left', -9, -2],
      ['right', 9, -2],
      ['back', 20, -2],
    ],
  } as const;
  // The far forest fixes are seasonal: the outdoor stages' level views in autumn and winter by day.
  const seasonal = {
    sauna: [],
    water: [['front', 0, 0]],
    totonou: [
      ['front', 0, 0],
      ['left', -9, 0],
      ['right', 9, 0],
    ],
  } as const;
  for (const [stage, next] of [
    ['sauna', '水風呂へ'],
    ['water', '外気浴へ'],
    ['totonou', null],
  ] as const) {
    await expect(scene).toHaveAttribute('data-stage', stage);
    await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
    for (const lighting of ['day', 'evening', 'night']) {
      await chooseSceneSetting(page, '3Dの時間帯', lighting);
      await expect(scene).toHaveAttribute('data-lighting', lighting);
      for (const [name, yaw, pitch] of views[stage])
        await look(yaw, pitch, () => capture(`${stage}-${lighting}-${name}.png`));
    }
    if (seasonal[stage].length) {
      await chooseSceneSetting(page, '3Dの時間帯', 'day');
      await expect(scene).toHaveAttribute('data-lighting', 'day');
      for (const season of ['autumn', 'winter']) {
        await chooseSceneSetting(page, '3Dの季節', season);
        await expect(scene).toHaveAttribute('data-season', season);
        for (const [name, yaw, pitch] of seasonal[stage])
          await look(yaw, pitch, () => capture(`${stage}-${season}-${name}.png`));
      }
      await chooseSceneSetting(page, '3Dの季節', 'summer');
      await expect(scene).toHaveAttribute('data-season', 'summer');
    }
    await page.getByRole('button', { name: '操作を表示', exact: true }).click();
    if (next) await page.getByRole('button', { name: next, exact: true }).click();
  }
  expect(errors).toEqual([]);
  await info.attach('look-fixes', {
    contentType: 'application/json',
    body: JSON.stringify({ run, browser: browser.version(), captures, errors }),
  });
});
