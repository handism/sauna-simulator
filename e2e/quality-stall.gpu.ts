import { expect, test } from '@playwright/test';
import { observeSoakTiming } from './soak-timing';

test('diagnose synchronous work on quality changes', async ({ page }, info) => {
  await page.addInitScript(observeSoakTiming);
  await page.goto('?view=3d');
  await page.getByRole('button', { name: '静かに入室する' }).click();
  const scene = page.locator('.sauna-3d-canvas');
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 20_000 });
  await page.getByLabel('3Dの時間帯').selectOption('evening');
  for (const quality of ['high', 'low', 'high', 'low']) {
    await page.getByLabel('3Dの画質').selectOption(quality);
    await expect(scene).toHaveAttribute('data-quality', quality);
    await page.waitForTimeout(4000);
  }
  await info.attach('soak-timing', {
    body: JSON.stringify(await page.evaluate(() => (window as unknown as { suiSoakTiming: unknown }).suiSoakTiming)),
    contentType: 'application/json',
  });
});
