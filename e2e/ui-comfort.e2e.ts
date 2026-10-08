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
    await page.screenshot({ path: info.outputPath('compact-sauna.png') });
    await page.getByLabel('音の設定', { exact: true }).click();
    const volume = page.getByRole('slider', { name: '音量' });
    await volume.focus();
    await volume.press('Home');
    await volume.press('ArrowRight');
    await expect(volume).toHaveValue('1');
    await expect(page.locator('.sound-control')).toHaveAttribute('data-muted', 'true');
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
    await page.getByRole('checkbox', { name: 'UIを隠しても呼吸ガイドを残す' }).check();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'UI非表示', exact: true }).click();
    await expect(page.locator('.stage-dock')).toBeHidden();
    await expect(page.locator('.breathing-circle-premium')).toBeVisible();
    await expect(page.locator('.breathing-circle-premium')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: info.outputPath('breathing-only.png') });
    await page.getByRole('button', { name: 'UI表示', exact: true }).click();
    await page.getByRole('button', { name: '詳しく表示' }).click();
    await page.getByText('今回の休息を振り返る').click();
    await expect(page.locator('.rest-summary')).toBeVisible();
    await page.getByRole('button', { name: 'UI非表示', exact: true }).click();
    await expect(page.locator('.breathing-circle-premium')).toHaveCSS('opacity', '1');
    await page.getByRole('button', { name: 'UI表示', exact: true }).click();
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
