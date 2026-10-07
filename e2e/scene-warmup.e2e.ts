import { chooseSceneSetting, switchSceneMode } from './settings-controls';
import { expect, test, type Page } from '@playwright/test';

// The trial warmup (?warmup=split, sceneWarmup.ts) with settings, sizes and exits arriving while
// it runs. Each step waits for the GPU with a one-pixel read; slowing that read past the 50 ms
// budget makes every step yield, so the test can act between steps even with a warm shader cache
// (150 ms keeps the garden's warmup longer than a stage transition's second).
// The timings are the slowed ones: not load times.

const scene = (page: Page) => page.locator('.sauna-3d-canvas');

async function enter(page: Page, errors: string[]) {
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const read = WebGL2RenderingContext.prototype.readPixels;
    WebGL2RenderingContext.prototype.readPixels = function (...args: unknown[]) {
      const end = performance.now() + ((window as { suiDrainMs?: number }).suiDrainMs ?? 150);
      while (performance.now() < end);
      return (read as (...a: unknown[]) => void).apply(this, args);
    };
    localStorage.setItem('sui-guide-dismissed', 'yes');
  });
  await page.goto('?view=3d&warmup=split&frameRate=full');
  await page.getByRole('button', { name: '音なしで入室する' }).click();
  await expect(scene(page)).toHaveAttribute('data-warmup', 'split');
}
async function ready(page: Page) {
  await expect(scene(page)).toHaveAttribute('data-load-ms', /\d+/, { timeout: 30_000 });
  await expect(scene(page)).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
  await expect(scene(page)).toHaveAttribute('data-warming', 'none');
}

for (const part of ['body', 'garden'] as const) {
  test(`the latest lighting chosen while the ${part} warms survives readiness and a stage change`, async ({
    page,
    browser,
  }, info) => {
    const errors: string[] = [];
    const requests: string[] = [];
    page.on('request', (request) => {
      if (/\/sauna(?:-garden)?\.glb$/.test(request.url())) requests.push(request.url());
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => localStorage.setItem('sui-lighting-mode', 'day'));
    await enter(page, errors);
    await expect(scene(page)).toHaveAttribute('data-warming', part, { timeout: 30_000 });
    const originalCanvas = await scene(page).locator('canvas').elementHandle();
    const choices = part === 'body' ? ['night', 'evening'] : ['evening', 'night'];
    for (const lighting of choices) {
      await chooseSceneSetting(page, '3Dの時間帯', lighting);
      // Both selections must land during this warmup, not just after it finishes.
      await expect(scene(page)).toHaveAttribute('data-warming', part);
    }
    await ready(page);
    const latest = choices.at(-1)!;
    const expectedTime = latest === 'night' ? '2.000' : '1.000';
    await expect(scene(page)).toHaveAttribute('data-lighting', latest);
    await expect(scene(page)).toHaveAttribute('data-time-of-day', expectedTime);
    await expect(scene(page)).toHaveAttribute('data-warmup', 'split');
    await expect(scene(page)).toHaveAttribute('data-warmup-undrawn', '0');
    await expect(scene(page)).toHaveAttribute('data-garden-warmup-undrawn', '0');
    await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
    await expect(scene(page)).toHaveAttribute('data-stage', 'water');
    await expect(scene(page)).toHaveAttribute('data-lighting', latest);
    await expect(scene(page)).toHaveAttribute('data-time-of-day', expectedTime);
    expect(
      await originalCanvas!.evaluate((canvas) => canvas === document.querySelector('.sauna-3d-canvas canvas')),
    ).toBe(true);
    expect(requests.filter((url) => url.endsWith('/sauna.glb'))).toHaveLength(1);
    expect(requests.filter((url) => url.endsWith('/sauna-garden.glb'))).toHaveLength(1);
    await expect(page.locator('.sound-control')).toHaveAttribute('data-muted', 'true');
    expect(errors).toEqual([]);
    await info.attach('warmup-lighting', {
      contentType: 'application/json',
      body: JSON.stringify({
        part,
        choices,
        browser: browser.version(),
        requests,
        errors,
        metrics: await scene(page).evaluate((element) => ({ ...(element as HTMLElement).dataset })),
      }),
    });
  });
}

test('a quality chosen while the body warms starts it over for that quality', async ({ page }) => {
  const errors: string[] = [];
  await enter(page, errors);
  await expect(scene(page)).toHaveAttribute('data-warming', 'body', { timeout: 20_000 });
  await chooseSceneSetting(page, '3Dの画質', 'low');
  await ready(page);
  await expect(scene(page)).toHaveAttribute('data-warmup-restarts', /^[1-9]/);
  await expect(scene(page)).toHaveAttribute('data-quality', 'low');
  await expect(scene(page)).toHaveAttribute('data-warmup-undrawn', '0');
  await expect(scene(page)).toHaveAttribute('data-warmup', 'split');
  expect(errors).toEqual([]);
});

test('a stage and a size changed while the garden warms wait for the step, then show', async ({ page }) => {
  const errors: string[] = [];
  await enter(page, errors);
  await expect(scene(page)).toHaveAttribute('data-load-ms', /\d+/, { timeout: 30_000 });
  await expect(scene(page)).toHaveAttribute('data-warming', 'garden', { timeout: 20_000 });
  const canvas = page.locator('.sauna-3d-canvas canvas');
  const before = await canvas.evaluate((element: HTMLCanvasElement) => [element.width, element.height]);
  // A new size clears the canvas: it waits while the canvas keeps the last full image.
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForTimeout(100);
  await expect(scene(page)).toHaveAttribute('data-warming', 'garden');
  expect(await canvas.evaluate((element: HTMLCanvasElement) => [element.width, element.height])).toEqual(before);
  await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
  await expect(scene(page)).toHaveAttribute('data-stage', 'water', { timeout: 20_000 });
  await ready(page);
  await expect(scene(page)).toHaveAttribute('data-warmup-restarts', /^[1-9]/);
  await expect(scene(page)).toHaveAttribute('data-garden-warmup-undrawn', '0');
  const after = await canvas.evaluate((element: HTMLCanvasElement) => [element.width, element.height]);
  const ratio = await page.evaluate(() => window.devicePixelRatio);
  expect(after).toEqual([Math.round(1000 * ratio), Math.round(700 * ratio)]);
  // The loop draws again: the frame metrics restart after the warmup.
  await expect(scene(page)).toHaveAttribute('data-frame-mean-ms', /\d+/, { timeout: 20_000 });
  expect(errors).toEqual([]);
});

test('2D while the body warms, then context loss while the garden warms, keep the session', async ({ page }) => {
  const errors: string[] = [];
  await enter(page, errors);
  await expect(scene(page)).toHaveAttribute('data-warming', 'body', { timeout: 20_000 });
  await switchSceneMode(page, '2Dに切り替え');
  await expect(scene(page)).toHaveCount(0);
  await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
  await expect(page.getByRole('heading', { name: '水風呂', exact: true })).toBeVisible();
  await switchSceneMode(page, '3Dを試す');
  await expect(scene(page)).toHaveAttribute('data-warming', 'garden', { timeout: 30_000 });
  await expect(scene(page)).toHaveAttribute('data-stage', 'water');
  const lost = await page.locator('.sauna-3d-canvas canvas').evaluate((canvas: HTMLCanvasElement) => {
    const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
    extension?.loseContext();
    return !!extension;
  });
  expect(lost).toBe(true);
  await expect(page.getByRole('status')).toContainText('2Dで続けています');
  await expect(scene(page)).toHaveCount(0);
  await expect(page.locator('.sound-control')).toHaveAttribute('data-muted', 'true');
  await switchSceneMode(page, '2Dに切り替え');
  await switchSceneMode(page, '3Dを試す');
  await ready(page);
  await expect(scene(page)).toHaveAttribute('data-stage', 'water');
  expect(errors).toEqual([]);
});

test('a warmup past the time limit returns to 2D, and a retry prepares the scene', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  // Each step takes a second: the body's steps cannot finish within 30 s.
  await page.addInitScript(() => Object.assign(window, { suiDrainMs: 1000 }));
  await enter(page, errors);
  await expect(page.getByRole('status')).toContainText('2Dで続けています', { timeout: 60_000 });
  await expect(scene(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'サウナルーム' })).toBeVisible();
  await page.evaluate(() => Object.assign(window, { suiDrainMs: 0 }));
  await switchSceneMode(page, '2Dに切り替え');
  await switchSceneMode(page, '3Dを試す');
  await ready(page);
  expect(errors).toEqual([]);
});
