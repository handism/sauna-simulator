import { expect, test } from '@playwright/test';
import { openSceneSettings } from './settings-controls';

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 844, height: 390 },
]) {
  test(`compact controls, audio and breathing at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto('?view=2d');
    await page.getByRole('button', { name: '音なしで入室する' }).click();
    await expect(page.getByRole('heading', { name: 'サウナルーム' })).toBeVisible();
    await expect(page.locator('.first-visit-guide')).toBeVisible();
    // The guide must not push the main action out of a low dock (StageDock pins it to the bottom).
    await expect(page.getByRole('button', { name: 'ロウリュ', exact: true })).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: 'わかりました' }).click();
    // Phones and low landscape screens start compact so the dock does not cover half the scenery.
    if (viewport.width > 600 && viewport.height > 480) {
      await page.getByRole('button', { name: 'コンパクト表示' }).click();
    }
    await expect(page.locator('.stage-dock')).toHaveAttribute('data-compact', 'true');
    await expect(page.locator('.sauna-meters-grid')).toBeHidden();
    await expect(page.locator('.stay-timer-row')).toBeVisible();
    await expect(page.getByRole('button', { name: 'ロウリュ', exact: true })).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: 'ロウリュ', exact: true }).click();
    const feedback = page.locator('.loyly-feedback');
    await expect(feedback).toContainText('温度 +3');
    const notification = await feedback.boundingBox();
    const handle = await page.locator('.dock-handle').boundingBox();
    const loyly = await page.getByRole('button', { name: 'ロウリュ', exact: true }).boundingBox();
    expect(notification!.y).toBeGreaterThanOrEqual(handle!.y + handle!.height);
    expect(notification!.y + notification!.height).toBeLessThanOrEqual(loyly!.y);
    await expect(page.getByRole('button', { name: '体験を終える', exact: true })).toBeInViewport({ ratio: 1 });
    if (viewport.width <= 480) {
      const label = await page.locator('.ui-toggle-btn').evaluate((element) => {
        const style = getComputedStyle(element, '::after');
        return { content: style.content, display: style.display };
      });
      expect(label.content).toContain('景色だけ見る');
      expect(label.display).not.toBe('none');
    }
    await page.screenshot({ path: info.outputPath('compact-sauna.png') });
    await page.getByLabel('音の設定', { exact: true }).click();
    const volume = page.getByRole('slider', { name: '音量' });
    await volume.focus();
    await volume.press('Home');
    await volume.press('ArrowRight');
    await expect(volume).toHaveValue('1');
    await expect(page.locator('.sound-control')).toHaveAttribute('data-muted', 'true');
    await page.locator('.sauna-steam-particle').waitFor({ state: 'detached' });
    await volume.press('Space');
    await expect(page.locator('.sauna-steam-particle')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('音の設定', { exact: true })).toBeFocused();
    await expect(volume).toBeHidden();
    await page.getByRole('button', { name: '水風呂へ' }).click();
    await expect(page.getByRole('button', { name: '詳しく表示' })).toBeVisible();
    await page.getByRole('button', { name: '外気浴へ' }).click();
    await expect(page.getByRole('heading', { name: '外気浴', exact: true })).toBeVisible();
    await openSceneSettings(page);
    await page.getByText('その他', { exact: true }).click();
    await page.getByRole('checkbox', { name: 'UIを隠しても呼吸ガイドを残す' }).check();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
    await expect(page.locator('.stage-dock')).toBeHidden();
    await expect(page.locator('.breathing-circle-premium')).toBeVisible();
    await expect(page.locator('.breathing-circle-premium')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: info.outputPath('breathing-only.png') });
    await page.getByRole('button', { name: '操作を表示', exact: true }).click();
    await page.getByRole('button', { name: '詳しく表示' }).click();
    // Expanding the dock alone used to cover the breathing ring on a short phone.
    const ring = await page.locator('.breathing-circle-premium').boundingBox();
    const dock = await page.locator('.rest-dock').boundingBox();
    const overlaps =
      ring!.x < dock!.x + dock!.width &&
      ring!.x + ring!.width > dock!.x &&
      ring!.y < dock!.y + dock!.height &&
      ring!.y + ring!.height > dock!.y;
    expect(overlaps).toBe(false);
    await page.screenshot({ path: info.outputPath('rest-expanded.png') });
    await page.getByText('今回の休息を振り返る').click();
    await expect(page.locator('.rest-summary')).toBeVisible();
    await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
    await expect(page.locator('.breathing-circle-premium')).toHaveCSS('opacity', '1');
    await page.getByRole('button', { name: '操作を表示', exact: true }).click();
    await expect(page.getByText('ととのい度', { exact: true })).toBeHidden();
    await page.getByText('体験内のスコアを見る').click();
    await expect(page.getByText('ととのい度', { exact: true })).toBeVisible();
    await page.getByText('体験内のスコアを見る').click();
    await page.getByRole('button', { name: 'もう一度サウナへ' }).click();
    await expect(page.getByRole('heading', { name: 'サウナルーム' })).toBeVisible();
    await expect(page.locator('.first-visit-guide')).toHaveCount(0);
    await page.getByLabel('音の設定', { exact: true }).click();
    await expect(volume).toHaveValue('1');
    await page.reload();
    await page.getByRole('button', { name: '音なしで入室する' }).click();
    await expect(page.getByRole('heading', { name: 'サウナルーム' })).toBeVisible();
    await expect(page.locator('.first-visit-guide')).toHaveCount(0);
  });
}

test('entry offers explicit 3D selection without loading it before entry', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('?view=2d');
  await page.getByRole('button', { name: '3Dで見渡す' }).click();
  await expect(page.getByRole('button', { name: '3Dで見渡す' })).toHaveAttribute('aria-pressed', 'true');
  expect(requests.some((url) => url.endsWith('.glb'))).toBe(false);
  await page.getByRole('button', { name: '音なしで入室する' }).click();
  await expect(page.locator('.sauna-3d-canvas')).toHaveAttribute('data-load-ms', /\d+/, { timeout: 30_000 });
});

for (const width of [320, 390]) {
  test(`3D settings keep primary choices visible and extras keyboard accessible at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 568 });
    await page.goto('?view=3d');
    await openSceneSettings(page);
    await expect(page.getByLabel('3Dの時間帯')).toBeInViewport({ ratio: 1 });
    await expect(page.getByLabel('3Dの画質')).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: '全画面表示' })).toBeHidden();
    await expect(page.getByRole('link', { name: '素材クレジット' })).toBeHidden();
    await page.getByLabel('3Dの画質').selectOption('low');
    await page.getByLabel('3Dの時間帯').selectOption('night');
    await page.screenshot({ path: info.outputPath('primary-settings.png') });
    const more = page.locator('.settings-more > summary');
    await more.focus();
    await more.press('Enter');
    await expect(page.getByRole('link', { name: '素材クレジット' })).toBeVisible();
    await page.getByRole('checkbox', { name: 'UIを隠しても呼吸ガイドを残す' }).check();
    await page.keyboard.press('Escape');
    await expect(page.locator('.display-settings > summary')).toBeFocused();
    await expect(page.getByLabel('3Dの画質')).toBeHidden();
    await openSceneSettings(page);
    await expect(page.getByLabel('3Dの画質')).toHaveValue('low');
    await expect(page.getByLabel('3Dの時間帯')).toHaveValue('night');
    await expect(page.getByRole('checkbox', { name: 'UIを隠しても呼吸ガイドを残す' })).toBeChecked();
  });
}
