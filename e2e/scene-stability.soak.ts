import { expect, test } from '@playwright/test';

test('five minutes of effects, stages, quality and mode changes remain usable', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const samples: { cycle: number; elapsedMs: number; data: Record<string, string | undefined> }[] = [];
  const baselines = new Map<string, { textures: string | undefined; geometries: string | undefined }>();
  const started = Date.now();
  let cycle = 0;
  const scene = page.locator('.sauna-3d-canvas');
  const ready = async () => {
    await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 20_000 });
    await expect(scene.locator('canvas')).toHaveCount(1);
  };
  const sample = async () => {
    await expect(scene).toHaveAttribute('data-frame-mean-ms', /\d+/, { timeout: 15_000 });
    const data = await scene.evaluate(element => ({ ...(element as HTMLElement).dataset }));
    samples.push({ cycle, elapsedMs: Date.now() - started, data });
    const key = `${data.stage}/${data.quality}`;
    const resources = { textures: data.textures, geometries: data.geometries };
    expect(Number(resources.textures)).toBeGreaterThan(0);
    expect(Number(resources.geometries)).toBeGreaterThan(0);
    if (baselines.has(key)) expect(resources, `renderer resources for ${key}`).toEqual(baselines.get(key));
    else baselines.set(key, resources);
    await expect(page.getByRole('button', { name: 'ミュート解除', exact: true })).toHaveAttribute('aria-pressed', 'true');
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
      await page.getByRole('button', { name: 'ロウリュ (Löyly)', exact: true }).click();
      // Let the entire six-second steam lifetime elapse before resource comparison.
      await page.waitForTimeout(6500);
      await sample();
      for (const [button, stage] of [['限界.. 水風呂へ 💧', 'water'], ['外気浴へ 🍃', 'totonou'], ['もう一度サウナへ 🔄', 'sauna']]) {
        await page.getByRole('button', { name: button, exact: true }).click();
        await expect(scene).toHaveAttribute('data-stage', stage);
        await sample();
        expect(await canvas!.evaluate(element => element === document.querySelector('.sauna-3d-canvas canvas'))).toBe(true);
      }
      await canvas!.dispose();
      await page.getByRole('button', { name: '2Dに切り替え' }).click();
      await expect(scene).toHaveCount(0);
      await page.getByRole('button', { name: '3Dを試す' }).click();
      await ready();
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
      body: JSON.stringify({ browser: page.context().browser()?.version(), viewport: page.viewportSize(),
        elapsedMs: Date.now() - started, cycles: cycle, samples, errors,
        limitations: 'Renderer resource counts only; not total GPU memory, audio-node counts, real-device performance or proof of leak absence.' }, null, 2),
      contentType: 'application/json',
    });
  }
});
