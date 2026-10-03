import { expect, test } from '@playwright/test';
import { observeSoakTiming } from './soak-timing';

test('diagnose synchronous work on the first 3D load and a recreated scene', async ({ page }, info) => {
  await page.addInitScript(observeSoakTiming);
  await page.goto('?view=3d');
  await page.getByRole('button', { name: '静かに入室する' }).click();
  const scene = page.locator('.sauna-3d-canvas');
  const loaded = async () => {
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 20_000 });
    await page.waitForTimeout(3000);
    return scene.evaluate((element) => ({ ...element.dataset }));
  };
  const first = await loaded();
  const marks = [await page.evaluate(() => performance.now())];
  await page.getByRole('button', { name: '2Dに切り替え' }).click();
  await expect(scene).toHaveCount(0);
  await page.getByRole('button', { name: '3Dを試す' }).click();
  const recreated = await loaded();
  marks.push(await page.evaluate(() => performance.now()));
  await info.attach('soak-timing', {
    body: JSON.stringify({
      // Ends of the two loads (page time), to split the events between them.
      marks,
      loads: [first, recreated],
      ...(await page.evaluate(() => {
        const timing = window as unknown as { suiSoakTiming: unknown; suiSoakOutside: unknown };
        return { events: timing.suiSoakTiming, outside: timing.suiSoakOutside };
      })),
    }),
    contentType: 'application/json',
  });
});
