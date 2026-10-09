import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chooseSceneSetting } from './settings-controls';
import { timeFrames } from './gpu-timer';

// Diagnostic ABBA comparison of the garden candidate while the view moves (the water's mirror is
// redrawn for every frame) and of the garden's load (decode, compile, then the first frame that
// uploads its buffers and redraws the static shadow maps). Deployed assets are never overwritten.
const REPEAT = Number(process.env.GARDEN_MOTION_REPEAT ?? 4);
const LOADS = Number(process.env.GARDEN_MOTION_LOADS ?? 6);
if (!Number.isInteger(REPEAT) || REPEAT < 1 || !Number.isInteger(LOADS) || LOADS < 1)
  throw new Error('Invalid GARDEN_MOTION_REPEAT or GARDEN_MOTION_LOADS');
const path = process.env.QA_GARDEN_MODEL;
if (!path) throw new Error('QA_GARDEN_MODEL is required');
const original = readFileSync('public/models/sauna-garden.glb');
const candidate = readFileSync(path);
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const inputHashes = Object.fromEntries(
  [
    'public/models/sauna.glb',
    'public/models/sauna.scene.json',
    'public/models/irradiance.bin',
    'public/models/reflection.bin',
    'e2e/garden-motion.gpu.ts',
    'e2e/gpu-timer.ts',
  ].map((path) => [path, hash(readFileSync(path))]),
);
test.use({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });

type Measured = Window & {
  suiGpuMs: number[];
  suiFrameAt: number[];
  suiMeasure: boolean;
  suiAfterDraw?: () => void;
  suiPointerId?: number;
};

async function serveGarden(page: Page, bytes: Buffer) {
  const served = { requests: 0 };
  await page.route('**/sauna-garden.glb', async (route) => {
    served.requests++;
    await route.fulfill({ body: bytes, contentType: 'model/gltf-binary' });
  });
  return served;
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

// Every drawn frame's interval / REPEAT over 4 s, with or without a 1 CSS px drag after each draw.
async function measure(page: Page, moving: boolean) {
  await page.evaluate((moving) => {
    const w = window as unknown as Measured;
    const canvas = document.querySelector('.sauna-3d-canvas canvas')!;
    let x = 600;
    // Alternate +1/−1 px so the view changes on every frame but stays at the same heading.
    w.suiAfterDraw = moving
      ? () => {
          x += x === 600 ? 1 : -1;
          canvas.dispatchEvent(
            new PointerEvent('pointermove', {
              bubbles: true,
              pointerId: w.suiPointerId,
              isPrimary: true,
              clientX: x,
              clientY: 400,
            }),
          );
        }
      : undefined;
    w.suiGpuMs = [];
    w.suiFrameAt = [];
    w.suiMeasure = true;
  }, moving);
  await page.waitForTimeout(4000);
  const mirror = await page.locator('.sauna-3d-canvas').evaluate((el) => ({
    calls: (el as HTMLElement).dataset.mirrorCalls ?? null,
    size: (el as HTMLElement).dataset.mirrorSize ?? null,
  }));
  await page.evaluate(() => {
    const w = window as unknown as Measured;
    w.suiMeasure = false;
    w.suiAfterDraw = undefined;
  });
  await page.waitForTimeout(1000);
  const { times, frameAt } = await page.evaluate(() => {
    const w = window as unknown as Measured;
    return { times: w.suiGpuMs, frameAt: w.suiFrameAt };
  });
  expect(frameAt.length).toBeGreaterThan(10);
  const sorted = [...times].sort((a, b) => a - b);
  return {
    frames: frameAt.length,
    intervalMeanMs: (frameAt[frameAt.length - 1] - frameAt[0]) / (frameAt.length - 1) / REPEAT,
    gpuTimerMedianMs: sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : null,
    mirror,
  };
}

// Times of rAF callbacks around the garden's addition, for the load comparison.
function recordCallbacks() {
  type Recorded = Window & { suiCallbacks: { start: number; ms: number; garden: string | null }[] };
  const w = window as unknown as Recorded;
  w.suiCallbacks = [];
  const native = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) =>
    native((time) => {
      const element = document.querySelector<HTMLElement>('.sauna-3d-canvas');
      const garden = element?.dataset.garden ?? null;
      const start = performance.now();
      callback(time);
      if (garden === 'ready' || garden === 'loading')
        w.suiCallbacks.push({ start, ms: performance.now() - start, garden });
    });
}

for (const [index, variant] of ['original', 'candidate', 'candidate', 'original'].entries()) {
  test(`garden motion ${index} ${variant}`, async ({ page, context, browser }, info) => {
    test.setTimeout(600_000);
    const bytes = variant === 'candidate' ? candidate : original;
    const errors = collectErrors(page);
    const served = await serveGarden(page, bytes);
    await page.addInitScript(timeFrames, REPEAT);
    await page.addInitScript(() => {
      window.addEventListener('pointerdown', (event) => {
        (window as unknown as Measured).suiPointerId = event.pointerId;
      });
    });
    await page.goto('?view=3d&resolution=fixed&frameRate=full');
    await page.getByRole('button', { name: '音なしで入室する' }).click();
    const scene = page.locator('.sauna-3d-canvas');
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
    await chooseSceneSetting(page, '3Dの画質', 'standard');
    await expect(scene).toHaveAttribute('data-quality', 'standard');
    expect(await page.evaluate(() => Boolean((window as unknown as { suiTimer?: object }).suiTimer))).toBe(true);
    const rows = [];
    for (const [stage, next] of [
      ['sauna', '水風呂へ'],
      ['water', '外気浴へ'],
      ['totonou', null],
    ] as const) {
      await expect(scene).toHaveAttribute('data-stage', stage);
      await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
      for (const lighting of ['day', 'evening', 'night']) {
        await chooseSceneSetting(page, '3Dの時間帯', lighting);
        await expect(scene).toHaveAttribute('data-lighting', lighting);
        // A real press starts the drag (pointer capture needs an active pointer); the moves are
        // dispatched between the repeated frames. Released before the next setting.
        await page.mouse.move(600, 400);
        await page.mouse.down();
        await page.waitForTimeout(2500);
        // Warm-up of the moving view (first mirror allocation and programs), not recorded.
        await measure(page, true);
        const still = await measure(page, false);
        const moving = await measure(page, true);
        await page.mouse.up();
        rows.push({
          stage,
          lighting,
          still,
          moving,
          metrics: await scene.evaluate((el) => ({ ...(el as HTMLElement).dataset })),
        });
      }
      await page.getByRole('button', { name: '操作を表示', exact: true }).click();
      if (next) await page.getByRole('button', { name: next, exact: true }).click();
    }
    expect(served.requests).toBe(1);
    expect(errors).toEqual([]);
    await page.close();

    // Fresh pages for the loads: the standard quality and the day are stored before the app reads them.
    const loads = [];
    for (let load = 0; load < LOADS; load++) {
      const loader = await context.newPage();
      const loadErrors = collectErrors(loader);
      const loadServed = await serveGarden(loader, bytes);
      await loader.addInitScript(() => {
        localStorage.setItem('sui-quality', 'standard');
        localStorage.setItem('sui-lighting-mode', 'day');
      });
      await loader.addInitScript(recordCallbacks);
      await loader.goto('?view=3d&resolution=fixed&frameRate=full');
      await loader.getByRole('button', { name: '音なしで入室する' }).click();
      const element = loader.locator('.sauna-3d-canvas');
      await expect(element).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
      await expect(element).toHaveAttribute('data-quality', 'standard');
      await expect(element).toHaveAttribute('data-lighting', 'day');
      await loader.waitForTimeout(1500);
      const data = await element.evaluate((el) => ({ ...(el as HTMLElement).dataset }));
      const callbacks = await loader.evaluate(
        () =>
          (window as unknown as { suiCallbacks: { start: number; ms: number; garden: string | null }[] }).suiCallbacks,
      );
      const first = callbacks.findIndex((c) => c.garden === 'ready');
      expect(first).toBeGreaterThan(0);
      const after = callbacks.slice(first, first + 4);
      expect(after).toHaveLength(4);
      expect(loadServed.requests).toBe(1);
      expect(loadErrors).toEqual([]);
      loads.push({
        loadMs: Number(data.loadMs),
        gardenMs: Number(data.gardenMs),
        gardenPhaseMs: Number(data.gardenMs) - Number(data.loadMs),
        // The first callback with the garden drawn uploads its buffers and redraws the shadow maps.
        firstCallbackMs: after[0].ms,
        firstIntervalMs: after[1].start - after[0].start,
        laterCallbackMs: after.slice(1).map((c) => c.ms),
        laterIntervalMs: [after[2].start - after[1].start, after[3].start - after[2].start],
        loadingCallbacks: callbacks.slice(0, first).filter((c) => c.garden === 'loading').length,
        stage: data.stage,
        lighting: data.lighting,
        quality: data.quality,
        drawCalls: data.drawCalls,
      });
      await loader.close();
    }
    await info.attach('garden-motion', {
      contentType: 'application/json',
      body: JSON.stringify({
        index,
        variant,
        browser: browser.version(),
        quality: 'standard',
        repeat: REPEAT,
        loads: LOADS,
        inputHashes,
        dpr: 1,
        modelSha256: hash(bytes),
        modelBytes: bytes.length,
        originalSha256: hash(original),
        candidateSha256: hash(candidate),
        requests: served.requests,
        errors,
        rows,
        loadRuns: loads,
      }),
    });
  });
}
