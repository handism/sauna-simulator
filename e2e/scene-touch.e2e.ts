import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' });

test('touch look survives a second finger and cancellation; controls remain tappable', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('?view=3d');
  await page.getByRole('button', { name: '静かに入室する' }).tap();
  const scene = page.locator('.sauna-3d-canvas');
  const canvas = scene.locator('canvas');
  await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 20_000 });
  const original = await canvas.elementHandle();
  await page.getByRole('button', { name: 'UI非表示', exact: true }).tap();
  // Finish UI fades before comparing the static, reduced-motion scene.
  const picture = () => canvas.screenshot({ animations: 'disabled' });

  // CDP generates browser touch/pointer events, including capture and hit testing.
  // This is desktop Chrome touch emulation, not a mobile hardware test.
  const input = await page.context().newCDPSession(page);
  const touch = (
    type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
    touchPoints: { id: number; x: number; y: number }[],
  ) => input.send('Input.dispatchTouchEvent', { type, touchPoints });
  const before = await picture();
  await touch('touchStart', [{ id: 1, x: 100, y: 420 }]);
  await touch('touchMove', [{ id: 1, x: 150, y: 420 }]);
  await expect.poll(async () => (await picture()).equals(before)).toBe(false);
  const firstMove = await picture();
  await touch('touchStart', [
    { id: 1, x: 150, y: 420 },
    { id: 2, x: 280, y: 420 },
  ]);
  await touch('touchMove', [
    { id: 1, x: 150, y: 420 },
    { id: 2, x: 300, y: 420 },
  ]);
  expect((await picture()).equals(firstMove)).toBe(true);
  // Removing only the secondary point produces its pointerup.
  await touch('touchMove', [{ id: 1, x: 150, y: 420 }]);
  await touch('touchMove', [{ id: 1, x: 200, y: 420 }]);
  await expect.poll(async () => (await picture()).equals(firstMove)).toBe(false);
  await touch('touchCancel', []);
  const cancelled = await picture();
  await touch('touchStart', [{ id: 3, x: 200, y: 420 }]);
  await touch('touchMove', [{ id: 3, x: 200, y: 480 }]);
  await touch('touchEnd', []);
  await expect.poll(async () => (await picture()).equals(cancelled)).toBe(false);
  await input.detach();

  await page.getByRole('button', { name: 'UI表示', exact: true }).tap();
  for (const [button, stage] of [
    ['限界.. 水風呂へ 💧', 'water'],
    ['外気浴へ 🍃', 'totonou'],
    ['もう一度サウナへ 🔄', 'sauna'],
  ]) {
    await page.getByRole('button', { name: button, exact: true }).tap();
    await expect(scene).toHaveAttribute('data-stage', stage);
  }
  expect(await original!.evaluate((element) => element === document.querySelector('.sauna-3d-canvas canvas'))).toBe(
    true,
  );
  await expect(page.getByRole('button', { name: 'ミュート解除', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '2Dに切り替え' }).tap();
  await expect(scene).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'サウナルーム' })).toBeVisible();
  expect(errors).toEqual([]);
  await info.attach('touch-validation', {
    body: JSON.stringify(
      {
        browser: page.context().browser()?.version(),
        viewport: page.viewportSize(),
        input: 'CDP touch emulation',
        errors,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});
