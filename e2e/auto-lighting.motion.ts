import { chooseSceneSetting, switchSceneMode } from './settings-controls';
import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

type MotionClock = {
  realNow: () => number;
  offset: number;
  entered: number;
  started: number;
};
type MotionWindow = Window & { motionClock: MotionClock };

const warmup = process.env.MOTION_WARMUP ?? 'normal';
if (!['normal', 'split'].includes(warmup)) throw Error('Invalid MOTION_WARMUP');
const quality = process.env.MOTION_QUALITY ?? 'standard';
if (quality !== 'standard' && quality !== 'high') throw Error('Invalid MOTION_QUALITY');

const scope = process.env.MOTION_SCOPE ?? 'outdoor';
if (!['outdoor', 'sauna', 'all'].includes(scope)) throw Error('Invalid MOTION_SCOPE');
const look = process.env.MOTION_LOOK ?? 'sweep';
if (!['sweep', 'surround'].includes(look)) throw Error('Invalid MOTION_LOOK');
const conditions =
  scope === 'all'
    ? (['sauna', 'water', 'totonou'] as const).flatMap((stage) => [
        { stage, minute: 12, from: 0 },
        { stage, minute: 27, from: 1 },
      ])
    : scope === 'sauna'
      ? ([
          { stage: 'sauna', minute: 12, from: 0 },
          { stage: 'sauna', minute: 27, from: 1 },
        ] as const)
      : ([
          { stage: 'water', minute: 12, from: 0 },
          { stage: 'totonou', minute: 27, from: 1 },
        ] as const);

// Skip only the initial 12/27 minute hold. Once recording the transition, Date.now,
// rAF, timers and water animation all advance at their real rate. Video encoding
// adds overhead; neither the encoded frame rate nor this test is an FPS verdict.
for (const { stage, minute, from } of conditions) {
  test(`real-time automatic ${minute}-${minute + 3} minute transition in ${stage}`, async ({ page, browser }, info) => {
    const hashes = Object.fromEntries(
      [
        'src/components/3d/SaunaScene.tsx',
        'src/components/3d/lighting.ts',
        'src/components/3d/sceneWarmup.ts',
        'src/components/3d/warmupPasses.ts',
        'src/components/3d/warmupPrograms.ts',
        'src/components/3d/warmupScheduler.ts',
        'src/components/3d/hdrOutput.ts',
        'src/components/3d/softShadows.ts',
        'src/components/3d/planarReflection.ts',
        'src/hooks/useSaunaSession.ts',
        'e2e/auto-lighting.motion.ts',
        'playwright.motion.config.ts',
        'public/models/sauna.scene.json',
        'public/models/sauna.glb',
        'public/models/sauna-garden.glb',
        'public/models/irradiance.bin',
        'public/models/reflection.bin',
      ].map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]),
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.addInitScript(() => {
      const clock = { realNow: Date.now.bind(Date), offset: 0, entered: 0, started: 0 };
      (window as unknown as MotionWindow).motionClock = clock;
      Date.now = () => clock.realNow() + clock.offset;
      // The session takes its timestamp in this click's handler, a few ms later.
      document.addEventListener(
        'click',
        (event) => {
          const button = (event.target as Element).closest('button');
          if (button?.textContent?.includes('音なしで入室する')) clock.entered = Date.now();
        },
        true,
      );
    });
    // Select before entry so body and garden warmup also use the requested quality.
    await page.addInitScript((value) => localStorage.setItem('sui-quality', value), quality);
    await page.goto(`?view=3d&frameRate=full${warmup === 'split' ? '&warmup=split' : ''}`);
    await page.getByRole('button', { name: '音なしで入室する' }).click();
    const scene = page.locator('.sauna-3d-canvas');
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
    if (warmup === 'split') {
      await expect(scene).toHaveAttribute('data-warmup', 'split');
      await expect(scene).toHaveAttribute('data-warmup-undrawn', '0');
      await expect(scene).toHaveAttribute('data-garden-warmup-undrawn', '0');
    }
    await expect(scene).toHaveAttribute('data-quality', quality);
    // Settle at the starting light with the product's normal smoothing.
    await chooseSceneSetting(page, '3Dの時間帯', from === 0 ? 'day' : 'evening');
    if (stage !== 'sauna') {
      await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
      await expect(scene).toHaveAttribute('data-stage', 'water');
    }
    if (stage === 'totonou') {
      await page.getByRole('button', { name: '外気浴へ', exact: true }).click();
      await expect(scene).toHaveAttribute('data-stage', stage);
    }
    await expect(scene).toHaveAttribute('data-stage', stage);
    await expect(scene).toHaveAttribute('data-time-of-day', from.toFixed(3), { timeout: 20_000 });
    const recordingStart = await page.evaluate((startMinute) => {
      const clock = (window as unknown as MotionWindow).motionClock;
      if (!clock.entered) throw Error('Entry click was not observed');
      clock.offset = clock.entered + startMinute * 60_000 - clock.realNow();
      clock.started = performance.now();
      return { performanceMs: clock.started, wallMs: clock.realNow(), offsetMs: clock.offset };
    }, minute);
    await chooseSceneSetting(page, '3Dの時間帯', 'auto');
    await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
    const canvas = await scene.locator('canvas').elementHandle();
    expect(canvas).not.toBeNull();
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(false);

    const samples: { seconds: number; wallMs: number; time: number; data: Record<string, string> }[] = [];
    let dragging = false;
    let pointerX = 300;
    let pointerY = 400;
    let totalX = 0;
    let previousProgress = 0;
    const looks: { seconds: number; progress: number; totalX: number; pitchOffset: number }[] = [];
    let nextSample = 0;
    // Two slow ±0.5 rad sweeps, returning exactly to the original view. Static
    // sections expose reflection updates without camera-induced image changes.
    for (;;) {
      const seconds = await page.evaluate(
        () => (performance.now() - (window as unknown as MotionWindow).motionClock.started) / 1000,
      );
      const sweep =
        seconds >= 50 && seconds < 70 ? seconds - 50 : seconds >= 110 && seconds < 130 ? seconds - 110 : null;
      if (look === 'surround' && seconds >= 20 && previousProgress < 1) {
        const progress = Math.min(1, (seconds - 20) / 150);
        const dx = ((progress - previousProgress) * Math.PI * 2) / 0.004;
        const y = 400 + 100 * Math.sin(progress * Math.PI * 4);
        if (!dragging || pointerX + dx > 1050) {
          if (dragging) await page.mouse.up();
          pointerX = 300;
          await page.mouse.move(pointerX, pointerY);
          await page.mouse.down();
          dragging = true;
        }
        pointerX += dx;
        totalX += dx;
        await page.mouse.move(pointerX, y);
        pointerY = y;
        previousProgress = progress;
        looks.push({ seconds, progress, totalX, pitchOffset: -(y - 400) * 0.004 });
        if (progress === 1) {
          await page.mouse.up();
          dragging = false;
        }
      } else if (look === 'sweep' && sweep !== null) {
        if (!dragging) {
          await page.mouse.move(640, 400);
          await page.mouse.down();
          dragging = true;
        }
        await page.mouse.move(640 + 125 * Math.sin((sweep / 20) * Math.PI * 2), 400);
      } else if (look === 'sweep' && dragging) {
        await page.mouse.move(640, 400);
        await page.mouse.up();
        dragging = false;
      }
      if (seconds >= nextSample || seconds >= 195) {
        samples.push(
          await scene.evaluate((element) => {
            const clock = (window as unknown as MotionWindow).motionClock;
            const data = { ...(element as HTMLElement).dataset } as Record<string, string>;
            return {
              seconds: (performance.now() - clock.started) / 1000,
              wallMs: clock.realNow(),
              time: Number(data.timeOfDay),
              data,
            };
          }),
        );
        nextSample = seconds + 1;
      }
      if (seconds >= 195) break;
      await page.waitForTimeout(100);
    }
    await info.attach('auto-lighting-motion', {
      contentType: 'application/json',
      body: JSON.stringify(
        {
          browser: browser.version(),
          browserName: browser.browserType().name(),
          viewport: page.viewportSize(),
          quality,
          warmup,
          scope,
          look,
          looks,
          hashes,
          stage,
          minute,
          recordingStart,
          durationSeconds: 195,
          sweeps:
            look === 'surround'
              ? [[20, 170]]
              : [
                  [50, 70],
                  [110, 130],
                ],
          samples,
          errors,
        },
        null,
        2,
      ),
    });
    expect(samples.length).toBeGreaterThan(170);
    if (look === 'surround') {
      expect(previousProgress).toBe(1);
      expect(totalX * 0.004).toBeCloseTo(Math.PI * 2, 6);
      expect(Math.max(...looks.map((s) => s.pitchOffset))).toBeGreaterThan(0.39);
      expect(Math.min(...looks.map((s) => s.pitchOffset))).toBeLessThan(-0.39);
    }
    for (let index = 0; index < samples.length; index++) {
      const sample = samples[index];
      const target = from + Math.min(1, sample.seconds / 180);
      expect(sample.data.stage).toBe(stage);
      expect(sample.data.quality).toBe(quality);
      expect(sample.data.lighting).toBe('auto');
      expect(sample.data.garden).toBe('ready');
      if (warmup === 'split') {
        expect(sample.data.warmup).toBe('split');
        expect(sample.data.warmupUndrawn).toBe('0');
        expect(sample.data.gardenWarmupUndrawn).toBe('0');
      }
      expect(Math.abs(sample.time - target)).toBeLessThan(0.025);
      expect(Math.abs(sample.wallMs - recordingStart.wallMs - sample.seconds * 1000)).toBeLessThan(250);
      if (index) {
        expect(sample.time).toBeGreaterThanOrEqual(samples[index - 1].time);
        expect(sample.seconds - samples[index - 1].seconds).toBeLessThan(5);
      }
    }
    expect(samples.at(-1)!.time).toBe(from + 1);
    expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true);
    await page.getByRole('button', { name: '操作を表示', exact: true }).click();
    await switchSceneMode(page, '2Dに切り替え');
    await expect(scene).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
