import { expect, test } from '@playwright/test';
import { chooseSceneSetting } from './settings-controls';

// Layout review artifacts, not golden-image assertions or a performance measurement.
for (const variant of ['before', 'after'] as const) {
  test(`sauna seat ${variant}: responsive framing, steam and return`, async ({ page, browser }, info) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    if (variant === 'before') {
      await page.route('**/sauna.scene.json', async (route) => {
        const response = await route.fetch();
        const definition = await response.json();
        delete definition.stageViews;
        await route.fulfill({ response, json: definition });
      });
    }
    await page.goto('?sound=off&view=3d&frameRate=full');
    await page.getByRole('button', { name: '入室する', exact: true }).click();
    const scene = page.locator('.sauna-3d-canvas');
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
    const original = await scene.locator('canvas').elementHandle();
    const captures: string[] = [];
    const capture = async (name: string) => {
      const file = `${variant}-${name}.png`;
      await page.screenshot({ path: info.outputPath(file) });
      captures.push(file);
    };
    for (const [name, width, height] of [
      ['desktop', 1280, 800],
      ['portrait', 390, 844],
      ['landscape', 844, 390],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const lighting of ['day', 'evening', 'night']) {
        await chooseSceneSetting(page, '3Dの時間帯', lighting);
        await page.waitForTimeout(1200);
        await capture(`${name}-${lighting}`);
      }
      if (variant === 'after') {
        await chooseSceneSetting(page, '3Dの時間帯', 'day');
        await page.getByRole('button', { name: 'ロウリュ', exact: true }).click();
        await page.waitForTimeout(2500);
        await capture(`${name}-loyly`);
        await page.waitForTimeout(4000);
      }
    }
    if (variant === 'after') {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
      await page.waitForTimeout(1200);
      for (let heading = 0; heading < 8; heading++) {
        await capture(`look-${heading}`);
        await scene.focus();
        for (let step = 0; step < 10; step++) await page.keyboard.press('ArrowRight');
      }
      await page.getByRole('button', { name: '操作を表示', exact: true }).click();
      for (const [button, stage] of [
        ['水風呂へ', 'water'],
        ['外気浴へ', 'totonou'],
        ['もう一度サウナへ', 'sauna'],
      ]) {
        await page.getByRole('button', { name: button, exact: true }).click();
        await expect(scene).toHaveAttribute('data-stage', stage);
      }
      await page.waitForTimeout(1200);
      await capture('returned');
      expect(await original!.evaluate((canvas) => canvas === document.querySelector('.sauna-3d-canvas canvas'))).toBe(
        true,
      );
    }
    expect(errors).toEqual([]);
    await info.attach('seat-review', {
      body: JSON.stringify({ variant, browser: browser.version(), captures, errors }),
      contentType: 'application/json',
    });
  });
}
