import { expect, test } from '@playwright/test';

const chunkPath = /\/assets\/SaunaScene-[^/]+\.js$/;

test('a failed 3D module explains restart and recovers after explicit reload', async ({ page }, info) => {
  let attempts = 0;
  await page.route(chunkPath, async route => {
    attempts++;
    if (attempts === 1) await route.abort('failed');
    else await route.continue();
  });
  await page.goto('?view=3d');
  await page.getByRole('button', { name: '静かに入室する' }).click();
  await expect(page.getByRole('status')).toContainText('2Dで続けています');
  await expect(page.locator('.sauna-3d-canvas')).toHaveCount(0);
  await page.getByRole('button', { name: '限界.. 水風呂へ 💧', exact: true }).click();
  await expect(page.getByRole('heading', { name: '水風呂', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '2Dに切り替え' }).click();
  await page.getByRole('button', { name: '3Dを試す' }).click();
  await expect(page.getByRole('status')).toContainText('体験は最初からになります');
  expect(attempts).toBe(1);
  await expect(page.getByRole('heading', { name: '水風呂', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '最初から再読み込み', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('module-reload.png') });
  await page.getByRole('button', { name: '最初から再読み込み', exact: true }).click();
  await page.getByRole('button', { name: '静かに入室する' }).click();
  await expect(page.locator('.sauna-3d-canvas')).toHaveAttribute('data-load-ms', /\d+/, { timeout: 20_000 });
  await expect(page.locator('.sauna-3d-canvas')).toHaveAttribute('data-stage', 'sauna');
  await expect(page.getByRole('button', { name: 'ミュート解除', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(attempts).toBe(2);
  await expect(page.getByRole('button', { name: '最初から再読み込み', exact: true })).toHaveCount(0);
  await info.attach('module-reload', { body: JSON.stringify({ browser: page.context().browser()?.version(), attempts, recoveredStage: 'sauna' }), contentType: 'application/json' });
});

test('2D entry does not request the 3D module or model', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.goto('./');
  await page.getByRole('button', { name: '静かに入室する' }).click();
  await expect(page.getByRole('heading', { name: 'サウナルーム' })).toBeVisible();
  await page.getByRole('button', { name: '限界.. 水風呂へ 💧', exact: true }).click();
  await expect(page.getByRole('heading', { name: '水風呂', exact: true })).toBeVisible();
  expect(requests.filter(path => chunkPath.test(path) || path.includes('/models/'))).toEqual([]);
  await expect(page.locator('.sauna-3d-canvas')).toHaveCount(0);
});

test('a stalled 3D module times out before mounting and can recover after arrival', async ({ page }, info) => {
  const errors: string[] = [];
  const modelRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname.includes('/models/')) modelRequests.push(request.url());
  });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(chunkPath, async route => {
    await held;
    await route.continue();
  }, { times: 1 });
  try {
    await page.goto('?view=3d');
    const requested = page.waitForRequest(chunkPath);
    await page.getByRole('button', { name: '静かに入室する' }).click();
    await requested;
    const started = Date.now();
    await expect(page.getByRole('status')).toContainText('読み込み中');
    // Stage changes while waiting must not restart the load deadline.
    await page.getByRole('button', { name: '限界.. 水風呂へ 💧', exact: true }).click();
    await expect(page.getByRole('heading', { name: '水風呂', exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('2Dで続けています', { timeout: 35_000 });
    const elapsedMs = Date.now() - started;
    await expect(page.locator('.sauna-3d-canvas')).toHaveCount(0);
    const delivered = page.waitForResponse(chunkPath);
    release();
    await (await delivered).finished();
    // Allow module evaluation and React's lazy resolution to settle.
    await page.waitForTimeout(1000);
    await expect(page.getByRole('status')).toContainText('2Dで続けています');
    expect(modelRequests).toEqual([]);
    await expect(page.locator('.sauna-3d-canvas')).toHaveCount(0);
    await page.getByRole('button', { name: '外気浴へ 🍃', exact: true }).click();
    await expect(page.getByRole('heading', { name: '外気浴', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '2Dに切り替え' }).click();
    await page.getByRole('button', { name: '3Dを試す' }).click();
    await expect(page.locator('.sauna-3d-canvas')).toHaveAttribute('data-load-ms', /\d+/, { timeout: 20_000 });
    await expect(page.locator('.sauna-3d-canvas')).toHaveAttribute('data-stage', 'totonou');
    await expect(page.locator('.sauna-3d-canvas canvas')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'ミュート解除', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
    await info.attach('chunk-recovery', { body: JSON.stringify({ browser: page.context().browser()?.version(), viewport: page.viewportSize(), elapsedMs, errors }, null, 2), contentType: 'application/json' });
  } finally {
    release();
  }
});
