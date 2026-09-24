import { expect, test } from '@playwright/test';

test('keyboard shortcuts drive the session and fullscreen in a real browser', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('?view=2d');
  await expect(page.locator('.app-shortcut-hint')).toContainText('全画面');

  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(false);

  await page.getByRole('button', { name: '静かに入室する' }).click();
  await expect(page.getByRole('heading', { name: 'サウナルーム' })).toBeVisible();

  // A clicked button keeps focus in Chrome. Space must pour Löyly without also
  // clicking that button on keyup.
  await page.getByRole('button', { name: 'ミュート解除', exact: true }).click();
  const mute = page.getByRole('button', { name: 'ミュート', exact: true });
  await expect(mute).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('.sauna-steam-particle')).toHaveCount(1);
  await expect(mute).toHaveAttribute('aria-pressed', 'false');

  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: 'ミュート解除', exact: true })).toBeVisible();
  await page.keyboard.press('u');
  await expect(page.locator('.app-container')).toHaveClass(/ui-hidden/);
  await page.keyboard.press('u');
  await expect(page.locator('.app-container')).not.toHaveClass(/ui-hidden/);

  // The sauna stays on screen, inert, while it fades out; Space must not pour Löyly there.
  await expect(page.locator('.sauna-steam-particle')).toHaveCount(0, { timeout: 5_000 });
  await page.getByRole('button', { name: '限界.. 水風呂へ 💧' }).click();
  await page.keyboard.press('Space');
  await expect(page.locator('.sauna-steam-particle')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '水風呂' })).toBeVisible();

  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { name: '外気浴' })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { name: 'サウナルーム' })).toBeVisible();
  expect(errors).toEqual([]);
});
