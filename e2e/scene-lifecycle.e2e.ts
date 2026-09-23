import { expect, test, type Page } from '@playwright/test';

const scene = (page: Page) => page.locator('.sauna-3d-canvas');
const fallback = (page: Page) => page.getByRole('status');
async function enter(page: Page) {
  await page.goto('?view=3d');
  await page.getByRole('button', { name: '静かに入室する' }).click();
  await expect(page.getByRole('heading', { name: 'サウナルーム' })).toBeVisible();
}
async function ready(page: Page) {
  await expect(scene(page)).toHaveAttribute('data-load-ms', /\d+/, { timeout: 20_000 });
  await expect(page.locator('.sauna-3d-canvas canvas')).toHaveCount(1);
}
async function retry(page: Page) {
  await page.getByRole('button', { name: '2Dに切り替え' }).click();
  await expect(scene(page)).toHaveCount(0);
  await page.getByRole('button', { name: '3Dを試す' }).click();
  await ready(page);
}
async function metrics(page: Page) {
  await expect(scene(page)).toHaveAttribute('data-frame-mean-ms', /\d+/, { timeout: 15_000 });
  return scene(page).evaluate(element => ({ ...((element as HTMLElement).dataset) }));
}

test('repeated modes, stages and real context loss preserve the session', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enter(page);
  await ready(page);
  const samples = [await metrics(page)];
  for (let i = 0; i < 5; i++) {
    await retry(page);
    samples.push(await metrics(page));
    await expect(page.getByRole('button', { name: 'ミュート解除', exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  // Counts are renderer resources, not GPU bytes or proof of long-term stability.
  expect(new Set(samples.map(sample => sample.textures)).size).toBe(1);
  expect(new Set(samples.map(sample => sample.geometries)).size).toBe(1);
  const original = await scene(page).elementHandle();
  for (const [button, stage] of [['限界.. 水風呂へ 💧', 'water'], ['外気浴へ 🍃', 'totonou'], ['もう一度サウナへ 🔄', 'sauna']]) {
    await page.getByRole('button', { name: button, exact: true }).click();
    await expect(scene(page)).toHaveAttribute('data-stage', stage);
    expect(await original!.evaluate(element => element === document.querySelector('.sauna-3d-canvas'))).toBe(true);
  }
  const lost = await page.locator('.sauna-3d-canvas canvas').evaluate(canvas => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_lose_context');
    extension?.loseContext();
    return !!extension;
  });
  expect(lost, 'Chrome must support actual WebGL context loss').toBe(true);
  await expect(fallback(page)).toContainText('2Dで続けています');
  await expect(scene(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ミュート解除', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '限界.. 水風呂へ 💧', exact: true }).click();
  await expect(page.getByRole('heading', { name: '水風呂', exact: true })).toBeVisible();
  await retry(page);
  await expect(scene(page)).toHaveAttribute('data-stage', 'water');
  await page.screenshot({ path: info.outputPath('recovered-water.png') });
  await info.attach('resource-samples', { body: JSON.stringify({ browser: page.context().browser()?.version(), viewport: page.viewportSize(), samples, errors }, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]);
});

test('switching to 2D during a pending model request allows a clean retry', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requested!: () => void;
  const started = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/models/sauna.glb', async route => {
    requested();
    await held;
    await route.continue().catch(() => {}); // Request may have been aborted by unmount.
  }, { times: 1 });
  await enter(page);
  await started;
  await expect(fallback(page)).toContainText('読み込み中');
  await page.getByRole('button', { name: '2Dに切り替え' }).click();
  await expect(scene(page)).toHaveCount(0);
  release();
  await page.getByRole('button', { name: '3Dを試す' }).click();
  await ready(page);
  await expect(page.getByRole('heading', { name: 'サウナルーム' })).toBeVisible();
});

test('a real 30-second load timeout falls back and permits retry', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/models/sauna.glb', async route => {
    await held;
    await route.continue().catch(() => {});
  }, { times: 1 });
  await enter(page);
  await expect(fallback(page)).toContainText('読み込み中');
  await expect(fallback(page)).toContainText('2Dで続けています', { timeout: 35_000 });
  await expect(scene(page)).toHaveCount(0);
  release();
  await retry(page);
});

test('corrupt meshopt data falls back to 2D and a fresh model can recover', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/models/sauna.glb', async route => {
    const response = await route.fetch();
    const body = Buffer.from(await response.body());
    const jsonLength = body.readUInt32LE(12);
    const model = JSON.parse(body.subarray(20, 20 + jsonLength).toString());
    expect(model.extensionsRequired).toContain('EXT_meshopt_compression');
    const compressed = model.bufferViews.find((view: any) => view.extensions?.EXT_meshopt_compression)
      .extensions.EXT_meshopt_compression;
    // Break the compressed stream header, leaving the GLB structure valid.
    body[28 + jsonLength + compressed.byteOffset] = 0;
    await route.fulfill({ response, body });
  }, { times: 1 });
  await enter(page);
  await expect(fallback(page)).toContainText('2Dで続けています');
  await expect(scene(page)).toHaveCount(0);
  await page.getByRole('button', { name: '限界.. 水風呂へ 💧', exact: true }).click();
  await expect(page.getByRole('heading', { name: '水風呂', exact: true })).toBeVisible();
  await retry(page);
  await expect(scene(page)).toHaveAttribute('data-stage', 'water');
  await expect(page.getByRole('button', { name: 'ミュート解除', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});
