import { expect, test } from '@playwright/test';

test('3D lighting replaces the aurora only while the scene is ready', async ({ page, browser }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('?view=2d');
  await page.getByRole('button', { name: '静かに入室する' }).click();
  await page.getByRole('button', { name: '限界.. 水風呂へ 💧' }).click();
  await page.getByRole('button', { name: '外気浴へ 🍃' }).click();
  const aurora = page.locator('.aurora-container');
  await expect(aurora).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/models/sauna.glb', async route => {
    await held;
    await route.continue().catch(() => {});
  }, { times: 1 });
  await page.getByRole('button', { name: '3Dを試す' }).click();
  await expect(page.getByRole('status')).toContainText('読み込み中');
  await expect(aurora).toBeVisible();
  release();
  const scene = page.locator('.sauna-3d-canvas');
  await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 20_000 });
  // The exported moss ground and ferns carry Blender noise colors; losing them flattens the garden.
  await expect(scene).toHaveAttribute('data-noise-color-materials', /^[1-9]\d*$/);
  // Stone, linen and timber colors come from image-luminance ramps; without them the raw texture hues show.
  await expect(scene).toHaveAttribute('data-image-ramp-materials', /^[1-9]\d*$/);
  await expect(aurora).toBeHidden();
  const canvas = scene.locator('canvas');
  const original = await canvas.elementHandle();
  await page.getByRole('button', { name: 'UI非表示', exact: true }).click();
  await page.waitForTimeout(1200);
  for (const lighting of ['day', 'evening']) {
    await page.getByLabel('3Dの時間帯').selectOption(lighting);
    await expect(scene).toHaveAttribute('data-lighting', lighting);
    // Reconstruct the old overlay at a fixed point of its .45-.75 breathing
    // cycle. Camera, model and lighting stay identical for this comparison.
    const legacy = await page.addStyleTag({ content: '.aurora-container { display: block !important; opacity: .6 !important; transition: none !important; } .aurora-blob { animation: none !important; }' });
    await canvas.screenshot({ path: info.outputPath(`${lighting}-legacy.png`) });
    await legacy.evaluate(element => element.parentNode?.removeChild(element));
    await expect(aurora).toBeHidden();
    await canvas.screenshot({ path: info.outputPath(`${lighting}-3d.png`) });
  }
  expect(await original!.evaluate(element => element === document.querySelector('.sauna-3d-canvas canvas'))).toBe(true);
  await page.getByRole('button', { name: 'UI表示', exact: true }).click();
  await page.getByRole('button', { name: '2Dに切り替え' }).click();
  await expect(aurora).toBeVisible();
  await page.getByRole('button', { name: '3Dを試す' }).click();
  await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 20_000 });
  await expect(aurora).toBeHidden();
  expect(await canvas.evaluate(element => {
    const extension = (element as HTMLCanvasElement).getContext('webgl2')?.getExtension('WEBGL_lose_context');
    extension?.loseContext();
    return !!extension;
  })).toBe(true);
  await expect(page.getByRole('status')).toContainText('2Dで続けています');
  await expect(aurora).toBeVisible();
  await expect(page.getByRole('button', { name: 'ミュート解除', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'もう一度サウナへ 🔄' }).click();
  await expect(page.getByRole('heading', { name: 'サウナルーム' })).toBeVisible();
  expect(errors).toEqual([]);
  await info.attach('aurora-validation', { contentType: 'application/json', body: JSON.stringify({
    browser: browser.version(), viewport: page.viewportSize(), reducedMotion: true, muted: true,
    comparison: 'Legacy overlay reconstructed at fixed opacity .6; model, camera and lighting unchanged.', errors,
  }, null, 2) });
});
