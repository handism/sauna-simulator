import { expect, test } from '@playwright/test';
import { openSceneSettings } from './settings-controls';

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 844, height: 390 },
]) {
  test(`dock controls, audio and breathing at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto('?sound=off&view=2d');
    await page.getByRole('button', { name: '入室する', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'サウナルーム' })).toBeVisible();
    // One dock for every screen: readings, stay and actions, without a second level to open.
    await expect(page.locator('.sauna-meters-grid')).toBeVisible();
    await expect(page.locator('.stay-timer-row')).toBeVisible();
    await expect(page.getByRole('button', { name: 'ロウリュ', exact: true })).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: 'ロウリュ', exact: true }).click();
    await expect(page.locator('.meter-delta').first()).toHaveText('+3');
    await expect(page.getByRole('button', { name: '体験を終える', exact: true })).toBeInViewport({ ratio: 1 });
    if (viewport.width <= 480) {
      const label = await page.locator('.ui-toggle-btn').evaluate((element) => {
        const style = getComputedStyle(element, '::after');
        return { content: style.content, display: style.display };
      });
      expect(label.content).toContain('景色');
      expect(label.display).not.toBe('none');
    }
    await page.screenshot({ path: info.outputPath('sauna-dock.png') });
    // The volume sits in the settings menu; changing it keeps the mute.
    await page.getByLabel('設定', { exact: true }).click();
    const volume = page.getByRole('slider', { name: /音量/ });
    await volume.focus();
    await volume.press('Home');
    await volume.press('ArrowRight');
    await expect(volume).toHaveValue('1');
    await expect(page.getByRole('button', { name: 'ミュート解除', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.locator('.sauna-steam-particle').waitFor({ state: 'detached' });
    await volume.press('Space');
    await expect(page.locator('.sauna-steam-particle')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('設定', { exact: true })).toBeFocused();
    await expect(volume).toBeHidden();
    await page.getByRole('button', { name: '水風呂へ' }).click();
    await expect(page.locator('.cooling-heart')).toBeVisible();
    await page.getByRole('button', { name: '外気浴へ' }).click();
    await expect(page.getByRole('heading', { name: '外気浴', exact: true })).toBeVisible();
    // The breathing guide is part of the scenery and stays when the controls are hidden.
    await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
    await expect(page.locator('.stage-dock')).toBeHidden();
    await expect(page.locator('.breathing-circle-premium')).toBeVisible();
    await expect(page.locator('.breathing-circle-premium')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: info.outputPath('breathing-only.png') });
    await page.getByRole('button', { name: '操作を表示', exact: true }).click();
    const ringOverlapsDock = async () => {
      const ring = await page.locator('.breathing-circle-premium').boundingBox();
      const dock = await page.locator('.rest-dock').boundingBox();
      return (
        ring!.x < dock!.x + dock!.width &&
        ring!.x + ring!.width > dock!.x &&
        ring!.y < dock!.y + dock!.height &&
        ring!.y + ring!.height > dock!.y
      );
    };
    expect(await ringOverlapsDock()).toBe(false);
    await expect(page.locator('.totonou-tier')).toBeInViewport();
    await page.screenshot({ path: info.outputPath('rest.png') });
    await page.getByRole('button', { name: 'もう一度サウナへ' }).click();
    await expect(page.getByRole('heading', { name: 'サウナルーム' })).toBeVisible();
    await page.getByLabel('設定', { exact: true }).click();
    await expect(volume).toHaveValue('1');
  });
}

test('entry offers explicit 3D selection without loading it before entry', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('?sound=off&view=2d');
  await page.getByRole('button', { name: '3Dで見渡す' }).click();
  await expect(page.getByRole('button', { name: '3Dで見渡す' })).toHaveAttribute('aria-pressed', 'true');
  expect(requests.some((url) => url.endsWith('.glb'))).toBe(false);
  await page.getByRole('button', { name: '入室する', exact: true }).click();
  await expect(page.locator('.sauna-3d-canvas')).toHaveAttribute('data-load-ms', /\d+/, { timeout: 30_000 });
});

for (const width of [320, 390]) {
  test(`3D settings keep every choice in one keyboard-accessible menu at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 568 });
    await page.goto('?sound=off&view=3d');
    await openSceneSettings(page);
    await expect(page.getByLabel('3Dの時間帯')).toBeInViewport({ ratio: 1 });
    // The quality is not a visitor's choice (the dynamic resolution adapts the standard preset).
    await expect(page.getByLabel('3Dの画質')).toHaveCount(0);
    await expect(page.getByRole('link', { name: '素材クレジット' })).toBeVisible();
    await page.getByLabel('3Dの時間帯').selectOption('night');
    await page.screenshot({ path: info.outputPath('primary-settings.png') });
    await page.getByRole('link', { name: '素材クレジット' }).focus();
    await expect(page.getByRole('link', { name: '素材クレジット' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.display-settings > summary')).toBeFocused();
    await expect(page.getByLabel('3Dの時間帯')).toBeHidden();
    await openSceneSettings(page);
    await expect(page.getByLabel('3Dの時間帯')).toHaveValue('night');
  });
}
