import { chooseSceneSetting, switchSceneMode } from './settings-controls';
import { expect, test } from '@playwright/test';
import { observeSoakTiming } from './soak-timing';

test('five minutes of effects, stages, quality and mode changes remain usable', async ({ page }, info) => {
  const diagnoseTiming = process.env.SOAK_TIMING === '1';
  if (diagnoseTiming) await page.addInitScript(observeSoakTiming);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const timingPolicy = { frames: 180, previousWindowMs: 15_000, sampleTimeoutMs: 30_000 };
  const samples: {
    cycle: number;
    elapsedMs: number;
    waitMs: number;
    frameWindowMs: number;
    exceedsPreviousWindow: boolean;
    data: Record<string, string | undefined>;
  }[] = [];
  const baselines = new Map<string, { textures: string | undefined; geometries: string | undefined }>();
  const started = Date.now();
  let cycle = 0;
  const scene = page.locator('.sauna-3d-canvas');
  const ready = async () => {
    await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 20_000 });
    // The woodland foliage loads after the ready scene.
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 20_000 });
    await expect(scene.locator('canvas')).toHaveCount(1);
  };
  const stages = [
    ['水風呂へ', 'water'],
    ['外気浴へ', 'totonou'],
    ['もう一度サウナへ', 'sauna'],
  ];
  const warmStages = async () => {
    // Three uploads geometry only when first rendered. Visit every stage before
    // comparing counts. Warm at high quality so a renderer created at low quality
    // also has the mirror geometry retained by one previously used at standard/high.
    const qualityControl = page.getByLabel('3Dの画質');
    const quality = await qualityControl.inputValue();
    await chooseSceneSetting(page, '3Dの画質', 'high');
    await expect(scene).toHaveAttribute('data-quality', 'high');
    for (const [button, stage] of stages) {
      await page.getByRole('button', { name: button, exact: true }).click();
      // setView draws synchronously with this stage update; the sampled pass
      // below waits for 180 frames. Do not collect another timing window here.
      await expect(scene).toHaveAttribute('data-stage', stage);
    }
    await chooseSceneSetting(page, '3Dの画質', quality);
    await expect(scene).toHaveAttribute('data-quality', quality);
  };
  const sample = async () => {
    // Wake the temporal history after a still view, then let it converge and skip again.
    // Return to the same direction so resource comparisons have the same visible geometry.
    await expect(scene).toHaveAttribute(
      'data-temporal',
      (await page.getByLabel('3Dの画質').inputValue()) === 'low' ? 'off' : 'on',
    );
    await page.getByRole('button', { name: 'UI非表示', exact: true }).click();
    const box = (await scene.locator('canvas').boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 24; step++) {
      await page.mouse.move(x + (step <= 12 ? step : 24 - step) * 8, y);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    }
    await page.mouse.up();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          let frames = 0;
          const tick = () => (++frames >= 70 ? resolve() : requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        }),
    );
    await page.getByRole('button', { name: 'UI表示', exact: true }).click();
    const waitStarted = Date.now();
    await expect(scene).toHaveAttribute('data-frame-mean-ms', /\d+/, { timeout: timingPolicy.sampleTimeoutMs });
    const data = await scene.evaluate((element) => ({ ...(element as HTMLElement).dataset }));
    // Waiting may begin after steam has finished; use the renderer's complete
    // 180-frame window to report slow rendering, not just the remaining wait.
    const frameWindowMs = Number(data.frameMeanMs) * timingPolicy.frames;
    expect(Number.isFinite(frameWindowMs)).toBe(true);
    expect(frameWindowMs).toBeGreaterThan(0);
    samples.push({
      cycle,
      elapsedMs: Date.now() - started,
      waitMs: Date.now() - waitStarted,
      frameWindowMs,
      exceedsPreviousWindow: frameWindowMs > timingPolicy.previousWindowMs,
      data,
    });
    const key = `${data.stage}/${data.quality}`;
    const resources = { textures: data.textures, geometries: data.geometries };
    expect(Number(resources.textures)).toBeGreaterThan(0);
    expect(Number(resources.geometries)).toBeGreaterThan(0);
    if (baselines.has(key)) expect(resources, `renderer resources for ${key}`).toEqual(baselines.get(key));
    else baselines.set(key, resources);
    await expect(page.locator('.sound-control')).toHaveAttribute('data-muted', 'true');
    expect(errors).toEqual([]);
  };
  try {
    await page.goto('?view=3d');
    await page.getByRole('button', { name: '音なしで入室する' }).click();
    await ready();
    const activeStarted = Date.now();
    // Real time, no fake clock: each cycle exercises all stages and recreates 3D.
    do {
      cycle++;
      const cycleStarted = Date.now();
      const quality = ['low', 'standard', 'high'][(cycle - 1) % 3];
      await chooseSceneSetting(page, '3Dの画質', quality);
      await expect(scene).toHaveAttribute('data-quality', quality);
      await chooseSceneSetting(page, '3Dの時間帯', ['day', 'evening', 'night'][cycle % 3]);
      const canvas = await scene.locator('canvas').elementHandle();
      await warmStages();
      await page.getByRole('button', { name: 'ロウリュ', exact: true }).click();
      // Let the entire six-second steam lifetime elapse before resource comparison.
      await page.waitForTimeout(6500);
      await sample();
      for (const [button, stage] of stages) {
        await page.getByRole('button', { name: button, exact: true }).click();
        await expect(scene).toHaveAttribute('data-stage', stage);
        await sample();
        expect(await canvas!.evaluate((element) => element === document.querySelector('.sauna-3d-canvas canvas'))).toBe(
          true,
        );
      }
      await canvas!.dispose();
      await switchSceneMode(page, '2Dに切り替え');
      await expect(scene).toHaveCount(0);
      await switchSceneMode(page, '3Dを試す');
      await ready();
      await warmStages();
      // Warm the recreated renderer's steam resources before comparing it.
      await page.getByRole('button', { name: 'ロウリュ', exact: true }).click();
      await page.waitForTimeout(6500);
      await sample();
      const remaining = 30_000 - (Date.now() - cycleStarted);
      if (remaining > 0) await page.waitForTimeout(remaining);
      console.log(`Soak cycle ${cycle}: ${Math.round((Date.now() - activeStarted) / 1000)}s, ${quality}`);
    } while (Date.now() - activeStarted < 300_000 || cycle < 6);
    await switchSceneMode(page, '2Dに切り替え');
    await expect(scene).toHaveCount(0);
    await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
    await expect(page.getByRole('heading', { name: '水風呂', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    if (diagnoseTiming)
      await info.attach('soak-timing', {
        body: JSON.stringify(
          await page.evaluate(() => (window as unknown as { suiSoakTiming: unknown }).suiSoakTiming),
        ),
        contentType: 'application/json',
      });
    await info.attach('stability-samples', {
      body: JSON.stringify(
        {
          browser: page.context().browser()?.version(),
          viewport: page.viewportSize(),
          elapsedMs: Date.now() - started,
          cycles: cycle,
          timingPolicy,
          slowSamples: samples.filter((sample) => sample.exceedsPreviousWindow).length,
          samples,
          errors,
          limitations:
            'Resource stability and usability only; slow frame windows are reported, not a performance pass. Not total GPU memory, audio-node counts, real-device performance or proof of leak absence.',
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  }
});
