import { expect, test } from '@playwright/test';
import { chooseSceneSetting } from './settings-controls';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';

// One run of a before/after (ABBA) still comparison of the garden stones and the mid-distance
// meadow. The run label comes from GROUND_RUN; GROUND_BASELINE_DIST serves the pre-change build.
const run = process.env.GROUND_RUN ?? 'after1';
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
test(`stones and meadow ${run}`, async ({ page, browser }, info) => {
  test.setTimeout(300_000);
  expect(!!process.env.GROUND_BASELINE_DIST).toBe(run.startsWith('before'));
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
  // Each view: [name, left(-)/right(+) key presses, up(+)/down(-) key presses] from the stage view.
  const views = [
    ['front', 0, 0],
    ['down', 0, -4],
    ['left', -9, -2],
    ['right', 9, -2],
  ] as const;
  for (const [stage, next] of [
    ['sauna', '水風呂へ'],
    ['water', '外気浴へ'],
    ['totonou', null],
  ] as const) {
    await expect(scene).toHaveAttribute('data-stage', stage);
    if (stage !== 'sauna') {
      await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
      for (const lighting of ['day', 'evening']) {
        await chooseSceneSetting(page, '3Dの時間帯', lighting);
        await expect(scene).toHaveAttribute('data-lighting', lighting);
        for (const [name, yaw, pitch] of stage === 'water' ? views.slice(0, 1) : views) {
          // Selecting a time of day focuses the settings menu: return input to the look surface.
          await scene.focus();
          const yawKey = yaw < 0 ? 'ArrowLeft' : 'ArrowRight';
          const pitchKey = pitch < 0 ? 'ArrowDown' : 'ArrowUp';
          for (let i = 0; i < Math.abs(yaw); i++) await page.keyboard.press(yawKey);
          for (let i = 0; i < Math.abs(pitch); i++) await page.keyboard.press(pitchKey);
          await capture(`${stage}-${lighting}-${name}.png`);
          for (let i = 0; i < Math.abs(yaw); i++) await page.keyboard.press(yaw < 0 ? 'ArrowRight' : 'ArrowLeft');
          for (let i = 0; i < Math.abs(pitch); i++) await page.keyboard.press(pitch < 0 ? 'ArrowUp' : 'ArrowDown');
        }
      }
      if (stage === 'totonou') {
        await chooseSceneSetting(page, '3Dの時間帯', 'day');
        for (const [option, value] of [
          ['3Dの季節', 'autumn'],
          ['3Dの季節', 'winter'],
        ] as const) {
          await chooseSceneSetting(page, option, value);
          await expect(scene).toHaveAttribute('data-season', value);
          await capture(`${stage}-${value}-front.png`);
        }
        await chooseSceneSetting(page, '3Dの季節', 'summer');
        await chooseSceneSetting(page, '天気', 'rain');
        await expect(scene).toHaveAttribute('data-weather', 'rain');
        await capture(`${stage}-rain-front.png`);
        await chooseSceneSetting(page, '天気', 'clear');
      }
      await page.getByRole('button', { name: '操作を表示', exact: true }).click();
    }
    if (next) await page.getByRole('button', { name: next, exact: true }).click();
  }
  expect(errors).toEqual([]);
  await info.attach('stones-meadow', {
    contentType: 'application/json',
    body: JSON.stringify({ run, browser: browser.version(), captures, errors }),
  });
});
