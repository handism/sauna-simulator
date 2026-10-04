import { expect, test } from '@playwright/test';
import { openSceneSettings, switchSceneMode } from './settings-controls';

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 844, height: 390 },
]) {
  test(`quiet UI, details and completion at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('?view=2d');
    await expect(page.getByLabel('体験の流れ')).toBeVisible();
    await expect(page.getByRole('button', { name: '3Dを試す' })).toBeHidden();
    await openSceneSettings(page);
    await expect(page.getByRole('button', { name: '3Dを試す' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.display-settings > summary')).toBeFocused();
    await expect(page.getByRole('button', { name: '3Dを試す' })).toBeHidden();
    await page.screenshot({ path: info.outputPath('welcome.png') });
    await page.getByRole('button', { name: '音なしで入室する' }).click();
    await expect(page.getByRole('heading', { name: 'サウナルーム' })).toBeFocused();
    await expect(page.getByText('体験の目安 0:50')).toBeVisible();
    await expect(page.getByText('心拍数', { exact: true })).toBeHidden();
    await page.getByText('からだの様子を見る').click();
    await expect(page.getByText('心拍数', { exact: true })).toBeVisible();
    await page.getByText('からだの様子を見る').click();
    await page.getByRole('button', { name: 'ロウリュ' }).click();
    await expect(page.locator('.sauna-steam-particle')).toHaveCount(1);
    await page.getByRole('button', { name: 'UI非表示', exact: true }).click();
    await expect(page.getByRole('button', { name: '水風呂へ' })).toBeHidden();
    await page.getByRole('button', { name: 'UI表示', exact: true }).click();
    await page.screenshot({ path: info.outputPath('sauna.png') });
    const next = page.getByRole('button', { name: '水風呂へ' });
    await expect(next).toBeInViewport({ ratio: 1 });
    await next.click();
    await expect(page.getByRole('heading', { name: '水風呂' })).toBeFocused();
    await page.getByRole('button', { name: '外気浴へ' }).click();
    await expect(page.getByRole('heading', { name: '外気浴' })).toBeFocused();
    await expect(page.getByText('ととのい度', { exact: true })).toBeHidden();
    await page.screenshot({ path: info.outputPath('rest.png') });
    await page.getByText('今回の休息を振り返る').click();
    await expect(page.getByText('ととのい度', { exact: true })).toBeHidden();
    await page.getByText('体験内のスコアを見る').click();
    await expect(page.getByText('ととのい度', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('rest-details.png') });
    await page.getByText('今回の休息を振り返る').click();
    const finish = page.getByRole('button', { name: '今日はここまで' });
    await expect(finish).toBeInViewport({ ratio: 1 });
    await finish.click();
    await expect(page.getByRole('heading', { name: '今日のひと息' })).toBeFocused();
    await expect(page.locator('.session-summary')).toContainText('1 セット');
    await page.getByText('体験内のスコアを見る').click();
    await expect(page.getByRole('list', { name: 'セットごとのととのい度' }).getByRole('listitem')).toHaveCount(1);
    await page.screenshot({ path: info.outputPath('finished.png') });
    await page.getByRole('button', { name: 'トップに戻る' }).click();
    await expect(page.getByRole('heading', { name: 'ブラウザサウナ' })).toBeFocused();
    await page.getByRole('button', { name: '音なしで入室する' }).click();
    await expect(page.getByRole('heading', { name: 'サウナルーム' })).toBeVisible();
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('ending the 3D session releases the scene and allows a fresh visit', async ({ page }) => {
  await page.goto('?view=3d');
  await page.getByRole('button', { name: '音なしで入室する' }).click();
  await expect(page.locator('.sauna-3d-canvas')).toHaveAttribute('data-load-ms', /\d+/, { timeout: 30_000 });
  await page.getByRole('button', { name: '水風呂へ' }).click();
  await page.getByRole('button', { name: '外気浴へ' }).click();
  await page.getByRole('button', { name: '今日はここまで' }).click();
  await expect(page.getByRole('heading', { name: '今日のひと息' })).toBeVisible();
  await expect(page.locator('.sauna-3d-canvas')).toHaveCount(0);
  await page.getByRole('button', { name: 'トップに戻る' }).click();
  await switchSceneMode(page, '2Dに切り替え');
  await page.getByRole('button', { name: '音なしで入室する' }).click();
  await expect(page.getByRole('heading', { name: 'サウナルーム' })).toBeVisible();
  await expect(page.locator('.sauna-3d-canvas')).toHaveCount(0);
});
