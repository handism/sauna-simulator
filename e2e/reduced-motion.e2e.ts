import { expect, test, type Locator } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });

const animationName = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).animationName);
const display = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).display);

test('reduced motion stops the 2D stages from pulsing, drifting and flashing', async ({ page }) => {
  await page.goto('?view=2d');
  await page.getByRole('button', { name: '静かに入室する' }).click();
  await expect(page.getByRole('heading', { name: 'サウナルーム' })).toBeVisible();

  // The heart pulse is an inline style; the media rule must still win.
  expect(await animationName(page.locator('.heart-rate-icon'))).toBe('none');
  await page.getByRole('button', { name: 'ロウリュ (Löyly)' }).click();
  // Löyly still counts; only its full-view blur and the particle are not shown.
  await expect(page.locator('.sauna-steam-particle')).toHaveCount(1);
  expect(await display(page.locator('.sauna-steam-particle'))).toBe('none');
  expect(await display(page.locator('.steam-overlay'))).toBe('none');

  await page.getByRole('button', { name: '限界.. 水風呂へ 💧' }).click();
  await expect(page.getByRole('heading', { name: '水風呂' })).toBeVisible();
  expect(await animationName(page.locator('.cooling-glow'))).toBe('none');
  await expect(page.locator('.cooling-ripple-effect').first()).toBeAttached({ timeout: 5_000 });
  expect(await display(page.locator('.cooling-ripple-effect').first())).toBe('none');

  await page.getByRole('button', { name: '外気浴へ 🍃' }).click();
  await expect(page.getByRole('heading', { name: '外気浴' })).toBeVisible();
  for (const blob of await page.locator('.aurora-blob').all()) {
    expect(await animationName(blob)).toBe('none');
  }
});

test('without the preference the 2D stages keep their motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('?view=2d');
  await page.getByRole('button', { name: '静かに入室する' }).click();
  await expect(page.getByRole('heading', { name: 'サウナルーム' })).toBeVisible();
  expect(await animationName(page.locator('.heart-rate-icon'))).toBe('breathe');
  await page.getByRole('button', { name: 'ロウリュ (Löyly)' }).click();
  expect(await display(page.locator('.sauna-steam-particle'))).toBe('block');
});
