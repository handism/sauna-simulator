import { chooseSceneSetting } from './settings-controls';
import { expect, test } from '@playwright/test';
import { rendererCaptureStyle } from './scene-capture';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// The afterimage of moving things (water, grass, rain) behind the temporal pass while looking around
// (docs/3d-qa/taa-ghosting/). Unlike resolution-shimmer.visual.ts the animation runs: every frame
// advances a controlled clock by DT and Math.random is seeded, so each page load draws the same
// frames. Unlike refraction-frame-control.ts the clock only goes forward, also when released between
// conditions: a frame time behind the last made the scene's smoothing NaN (lighting.ts). Per condition, `still-off` (time held, no TAA) and `off` (time running, no TAA) give the
// moving pixels and the true frame; the TAA variants are compared with `off` there.
// scripts/summarize_taa_ghosting.py does the comparison. Review artifacts, not an equivalence test.
test.use({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1.5, reducedMotion: 'no-preference' });

const DT = 1000 / 60;
const STEPS = 12;
const PX = Number(process.env.GHOST_PX ?? 2);
const AFTER = [2, 10, 30];
const TIME_BASE = Number(process.env.GHOST_TIME_BASE ?? 1_000_000);
const SIGMAS = (process.env.GHOST_SIGMAS ?? '1.25,2').split(',');

const variants = [
  { name: 'still-off', sigma: null, temporal: false, dt: 0 },
  { name: 'off', sigma: null, temporal: false, dt: DT },
  ...SIGMAS.map((sigma) => ({ name: `sigma${sigma}`, sigma, temporal: true, dt: DT })),
  { name: `sigma${SIGMAS[0]}-repeat`, sigma: SIGMAS[0], temporal: true, dt: DT },
];

function seedRandom() {
  let state = 0x2f6b1d;
  Math.random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface GhostClock {
  now: number;
  held: boolean;
  hold(): Promise<void>;
  jump(time: number): void;
  step(delta: number): Promise<void>;
}

/** Released, frames see the clock run with the display; held, only `step` delivers frames. */
function installGhostClock() {
  const native = window.requestAnimationFrame.bind(window);
  const cancel = window.cancelAnimationFrame.bind(window);
  const pending = new Map<number, FrameRequestCallback>();
  let last: number | null = null;
  const clock: GhostClock = {
    now: performance.now(),
    held: false,
    async hold() {
      clock.held = true;
      await new Promise<void>((resolve) => native(() => native(() => resolve())));
    },
    jump(time) {
      if (time < clock.now) throw Error('The clock only goes forward');
      clock.now = time;
    },
    async step(delta) {
      clock.now += delta;
      await new Promise<void>((resolve) =>
        native(() => {
          const callbacks = [...pending.values()];
          pending.clear();
          for (const callback of callbacks) callback(clock.now);
          native(() => resolve());
        }),
      );
    },
  };
  window.requestAnimationFrame = (callback) => {
    const id = native((time) => {
      if (last !== null && !clock.held) clock.now += Math.max(0, time - last);
      last = time;
      if (clock.held) pending.set(id, callback);
      else callback(clock.now);
    });
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    pending.delete(id);
    cancel(id);
  };
  (window as unknown as { ghostClock: GhostClock }).ghostClock = clock;
}

function setSigma(sigma: string) {
  const original = WebGL2RenderingContext.prototype.shaderSource;
  (window as any).ghostControls = 0;
  WebGL2RenderingContext.prototype.shaderSource = function (shader, source) {
    const marker = 'const float historySigma = 1.25;';
    if (source.includes(marker)) {
      if (source.split(marker).length !== 2) throw Error('Ambiguous temporal variance control');
      source = source.replace(marker, `const float historySigma = ${Number(sigma).toFixed(2)};`);
      (window as any).ghostControls++;
    }
    return original.call(this, shader, source);
  };
}

for (const variant of variants) {
  test(`capture moving things behind the temporal pass ${variant.name}`, async ({ page, browser }, info) => {
    test.setTimeout(900_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.addInitScript(seedRandom);
    await page.addInitScript(installGhostClock);
    if (variant.sigma && variant.sigma !== '1.25') await page.addInitScript(setSigma, variant.sigma);
    await page.goto(
      `?sound=off&quality&view=3d&frameRate=full&resolution=fixed&quality=standard&camera=review${variant.temporal ? '' : '&temporal=off'}`,
    );
    await page.getByRole('button', { name: '入室する', exact: true }).click();
    const scene = page.locator('.sauna-3d-canvas');
    const canvas = scene.locator('canvas');
    await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 120_000 });
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 120_000 });
    await expect(scene).toHaveAttribute('data-temporal', variant.temporal ? 'on' : 'off');
    type Win = { ghostClock: GhostClock };
    const advance = async (frames: number, dt: number) => {
      for (let n = 0; n < frames; n++) await page.evaluate((dt) => (window as unknown as Win).ghostClock.step(dt), dt);
    };
    const samples: object[] = [];
    let index = 0;
    for (const [stage, next] of [
      ['water', '外気浴へ'],
      ['totonou', null],
    ] as const) {
      if (stage === 'water') await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
      await expect(scene).toHaveAttribute('data-stage', stage);
      await page.waitForTimeout(1_200);
      for (const weather of ['clear', 'rain']) {
        await chooseSceneSetting(page, '天気', weather);
        await expect(scene).toHaveAttribute('data-weather', weather);
        await chooseSceneSetting(page, '3Dの時間帯', 'day');
        await expect(scene).toHaveAttribute('data-lighting', 'day');
        await expect(scene).toHaveAttribute('data-pixel-ratio', '1.5');
        await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
        // The same clock for every variant: the still-off run holds it at its start.
        await page.evaluate((t) => {
          const clock = (window as unknown as Win).ghostClock;
          clock.jump(t);
          return clock.hold();
        }, TIME_BASE * ++index);
        // Rain and the overcast come and go over a few seconds of frames, in every variant.
        await advance(720, DT);
        const box = (await canvas.boundingBox())!;
        const [x, y] = [box.x + box.width / 2 - (STEPS * PX) / 2, box.y + box.height / 2];
        const capture = async (phase: string, step: number) => {
          const file = `${stage}-${weather}-${phase}-${step}.png`;
          await canvas.screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
          const now = await page.evaluate(() => (window as unknown as Win).ghostClock.now);
          const data = await scene.evaluate((element: HTMLElement) => {
            const { rain, snow, timeOfDay, deckMirrorCalls, deckMirrorSize, temporal } = element.dataset;
            return { rain, snow, timeOfDay, deckMirrorCalls, deckMirrorSize, temporal };
          });
          samples.push({ file, path: info.outputPath(file), stage, weather, phase, step, now, data });
        };
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let step = 0; step <= STEPS; step++) {
          if (step > 0) await page.mouse.move(x + step * PX, y);
          await advance(2, variant.dt);
          await capture('turn', step);
        }
        await page.mouse.up();
        let done = 0;
        for (const after of AFTER) {
          await advance(after - done, variant.dt);
          done = after;
          await capture('after', after);
        }
        // Back to the default view, unheld.
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + STEPS * PX, y);
        await page.mouse.move(x, y);
        await page.mouse.up();
        await page.evaluate(() => {
          const clock = (window as unknown as Win).ghostClock;
          clock.held = false;
          return clock.step(0);
        });
        await page.getByRole('button', { name: '操作を表示', exact: true }).click();
      }
      if (next) await page.getByRole('button', { name: next, exact: true }).click();
    }
    expect(errors).toEqual([]);
    const controls = await page.evaluate(() => (window as any).ghostControls ?? 0);
    if (variant.sigma && variant.sigma !== '1.25') expect(controls).toBeGreaterThan(0);
    await info.attach('taa-ghosting', {
      contentType: 'application/json',
      body: JSON.stringify(
        {
          browser: browser.version(),
          variant,
          controls,
          sourceHash: createHash('sha256').update(readFileSync('src/components/3d/temporalAA.ts')).digest('hex'),
          yawPerStep: 0.004 * PX,
          samples,
        },
        null,
        2,
      ),
    });
  });
}
