import { expect, test } from '@playwright/test';

test('five minutes of effects, stages, quality and mode changes remain usable', async ({ page }, info) => {
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
    ['限界.. 水風呂へ 💧', 'water'],
    ['外気浴へ 🍃', 'totonou'],
    ['もう一度サウナへ 🔄', 'sauna'],
  ];
  const warmStages = async () => {
    // Three uploads geometry only when first rendered. Visit every stage before
    // comparing counts. Warm at high quality so a renderer created at low quality
    // also has the mirror geometry retained by one previously used at standard/high.
    const qualityControl = page.getByLabel('3Dの画質');
    const quality = await qualityControl.inputValue();
    await qualityControl.selectOption('high');
    await expect(scene).toHaveAttribute('data-quality', 'high');
    for (const [button, stage] of stages) {
      await page.getByRole('button', { name: button, exact: true }).click();
      // setView draws synchronously with this stage update; the sampled pass
      // below waits for 180 frames. Do not collect another timing window here.
      await expect(scene).toHaveAttribute('data-stage', stage);
    }
    await qualityControl.selectOption(quality);
    await expect(scene).toHaveAttribute('data-quality', quality);
  };
  const sample = async () => {
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
    await expect(page.getByRole('button', { name: 'ミュート解除', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(errors).toEqual([]);
  };
  try {
    await page.goto('?view=3d');
    await page.getByRole('button', { name: '静かに入室する' }).click();
    await ready();
    const activeStarted = Date.now();
    // Real time, no fake clock: each cycle exercises all stages and recreates 3D.
    do {
      cycle++;
      const cycleStarted = Date.now();
      const quality = ['low', 'standard', 'high'][(cycle - 1) % 3];
      await page.getByLabel('3Dの画質').selectOption(quality);
      await expect(scene).toHaveAttribute('data-quality', quality);
      await page.getByLabel('3Dの時間帯').selectOption(cycle % 2 ? 'day' : 'evening');
      const canvas = await scene.locator('canvas').elementHandle();
      await warmStages();
      await page.getByRole('button', { name: 'ロウリュ (Löyly)', exact: true }).click();
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
      await page.getByRole('button', { name: '2Dに切り替え' }).click();
      await expect(scene).toHaveCount(0);
      await page.getByRole('button', { name: '3Dを試す' }).click();
      await ready();
      await warmStages();
      // Warm the recreated renderer's steam resources before comparing it.
      await page.getByRole('button', { name: 'ロウリュ (Löyly)', exact: true }).click();
      await page.waitForTimeout(6500);
      await sample();
      const remaining = 30_000 - (Date.now() - cycleStarted);
      if (remaining > 0) await page.waitForTimeout(remaining);
      console.log(`Soak cycle ${cycle}: ${Math.round((Date.now() - activeStarted) / 1000)}s, ${quality}`);
    } while (Date.now() - activeStarted < 300_000 || cycle < 6);
    await page.getByRole('button', { name: '2Dに切り替え' }).click();
    await expect(scene).toHaveCount(0);
    await page.getByRole('button', { name: '限界.. 水風呂へ 💧', exact: true }).click();
    await expect(page.getByRole('heading', { name: '水風呂', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
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
