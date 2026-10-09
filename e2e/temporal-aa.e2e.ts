import { chooseSceneSetting } from './settings-controls';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { rendererCaptureStyle } from './scene-capture';

// The blend with the previous frames (src/components/3d/temporalAA.ts): a still view is the frame
// itself, as with ?temporal=off; turning, the images differ; the low quality leaves it out.
// Captures of the canvas at ratio 1.5 with reduced motion (the water is still).
test.use({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1.5, reducedMotion: 'reduce' });

// A still view gives the frame itself but where the half-float history stopped more than the
// tolerance away (about 0.01% of the pixels, a level each); NaN pixels of the scene show black.
const STILL_LEVELS = 1;
const STILL_SHARE = 1e-5;

// Decodes both PNGs in the browser; the share of pixels whose RGB differ by more than `levels`.
async function differingShare(page: Page, a: Buffer, b: Buffer, levels: number) {
  return page.evaluate(
    async ([first, second, over]) => {
      const pixels = async (base64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const [x, y] = await Promise.all([pixels(first as string), pixels(second as string)]);
      if (x.length !== y.length) return 1;
      let changed = 0;
      for (let i = 0; i < x.length; i += 4)
        if (
          Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2])) > Number(over)
        )
          changed++;
      return changed / (x.length / 4);
    },
    [a.toString('base64'), b.toString('base64'), levels],
  );
}

async function enter(page: Page, query: string) {
  await page.goto(`?view=3d&frameRate=full&resolution=fixed${query}`);
  await page.getByRole('button', { name: '音なしで入室する' }).click();
  const scene = page.locator('.sauna-3d-canvas');
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
  await chooseSceneSetting(page, '3Dの画質', 'standard');
  await chooseSceneSetting(page, '3Dの時間帯', 'day');
  await expect(scene).toHaveAttribute('data-lighting', 'day');
  return scene;
}

// The default view held still, then dragged right 1 px per frame for 12 frames.
async function capture(page: Page, scene: Locator) {
  const canvas = scene.locator('canvas');
  await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
  await page.waitForTimeout(1_500);
  const still = await canvas.screenshot({ style: rendererCaptureStyle });
  const box = (await canvas.boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step++) {
    await page.mouse.move(x + step, y);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
  const turning = await canvas.screenshot({ style: rendererCaptureStyle });
  await page.mouse.up();
  await page.getByRole('button', { name: '操作を表示', exact: true }).click();
  return { still, turning };
}

test('the temporal blend keeps still views and changes only frames while turning', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const scene = await enter(page, '');
  await expect(scene).toHaveAttribute('data-temporal', 'on');
  const blended = await capture(page, scene);
  await chooseSceneSetting(page, '3Dの画質', 'low');
  await expect(scene).toHaveAttribute('data-temporal', 'off');
  await chooseSceneSetting(page, '3Dの画質', 'standard');
  await expect(scene).toHaveAttribute('data-temporal', 'on');

  const other = await browser.newPage({
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 1.5,
    reducedMotion: 'reduce',
  });
  other.on('pageerror', (error) => errors.push(error.message));
  const plain = await enter(other, '&temporal=off');
  await expect(plain).toHaveAttribute('data-temporal', 'off');
  const single = await capture(other, plain);
  await other.close();

  expect(await differingShare(page, blended.still, single.still, STILL_LEVELS)).toBeLessThan(STILL_SHARE);
  // Turning, the history softens the popping leaves (about half the tile residual,
  // docs/3d-qa/temporal-aa/), so a few percent of the pixels differ.
  expect(await differingShare(page, blended.turning, single.turning, 2)).toBeGreaterThan(0.01);
  expect(errors).toEqual([]);
});
