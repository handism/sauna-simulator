import type { Page } from '@playwright/test';

export async function openSceneSettings(page: Page) {
  if ((await page.locator('.display-settings').getAttribute('open')) === null) {
    await page.locator('.display-settings > summary').click();
  }
}

export async function chooseSceneSetting(page: Page, label: '3Dの画質' | '3Dの時間帯', value: string) {
  await openSceneSettings(page);
  await page.getByLabel(label).selectOption(value);
  await page.locator('.display-settings > summary').click();
}

export async function switchSceneMode(page: Page, name: '3Dを試す' | '2Dに切り替え', touch = false) {
  await openSceneSettings(page);
  const button = page.getByRole('button', { name, exact: true });
  if (touch) await button.tap();
  else await button.click();
  await page.locator('.display-settings > summary').click();
}
