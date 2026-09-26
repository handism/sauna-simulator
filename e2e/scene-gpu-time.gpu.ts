import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

type Camera = { render: string; position: number[]; target: number[]; fov: number };
const cameras: Camera[] = JSON.parse(
  readFileSync(new URL('./fixtures/cycles-cameras.json', import.meta.url), 'utf8'),
).cameras;
const views = {
  stage: null,
  // Cycles camera 03 looks down on the plunge from beyond two of its sides.
  'camera-03': cameras.find((camera) => camera.render === '03.png')!,
};

test.use({ viewport: { width: 1200, height: 800 } });

// GPU time of every animation frame callback (all passes of a frame), from
// EXT_disjoint_timer_query_webgl2 around each callback. Installed before the app loads.
function timeFrames() {
  type Timed = Window & {
    suiGl?: WebGL2RenderingContext;
    suiTimer?: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    suiMeasure?: boolean;
    suiGpuMs: number[];
  };
  const w = window as unknown as Timed;
  w.suiGpuMs = [];
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, options?: unknown) {
    const context = getContext.call(this, type, options) as RenderingContext | null;
    if (type === 'webgl2' && context && !w.suiGl) {
      w.suiGl = context as WebGL2RenderingContext;
      w.suiTimer = w.suiGl.getExtension('EXT_disjoint_timer_query_webgl2');
    }
    return context;
  } as typeof getContext;
  const pending: WebGLQuery[] = [];
  const frame = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) =>
    frame((time) => {
      const gl = w.suiGl;
      const timer = w.suiTimer;
      const query = gl && timer && w.suiMeasure ? gl.createQuery() : null;
      if (query) gl!.beginQuery(timer!.TIME_ELAPSED_EXT, query);
      callback(time);
      if (query) {
        gl!.endQuery(timer!.TIME_ELAPSED_EXT);
        pending.push(query);
      }
      while (gl && timer && pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const done = pending.shift()!;
        if (!gl.getParameter(timer.GPU_DISJOINT_EXT))
          w.suiGpuMs.push(gl.getQueryParameter(done, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(done);
      }
    });
}

// Relative costs on one machine and browser, not frame budgets of other devices.
test('measure the GPU time of the sauna and plunge views', async ({ page, browser }, info) => {
  await page.addInitScript(timeFrames);
  const results: object[] = [];
  for (const [name, camera] of Object.entries(views)) {
    await page.route('**/sauna.scene.json', async (route) => {
      const definition = await (await route.fetch()).json();
      if (camera) definition.views.water = { position: camera.position, target: camera.target, fov: camera.fov };
      await route.fulfill({ json: definition });
    });
    await page.goto('?view=3d');
    await page.getByRole('button', { name: '静かに入室する' }).click();
    const scene = page.locator('.sauna-3d-canvas');
    await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 20_000 });
    const supported = await page.evaluate(() => Boolean((window as unknown as { suiTimer?: object }).suiTimer));
    test.skip(!supported, 'EXT_disjoint_timer_query_webgl2 is not available');
    await page.getByLabel('3Dの画質').selectOption('standard');
    for (const [stage, next] of [
      ['sauna', '限界.. 水風呂へ 💧'],
      ['water', '外気浴へ 🍃'],
    ] as const) {
      await expect(scene).toHaveAttribute('data-stage', stage);
      // The camera only replaces the plunge view.
      if (camera && stage === 'sauna') {
        await page.getByRole('button', { name: next, exact: true }).click();
        continue;
      }
      await page.getByRole('button', { name: 'UI非表示', exact: true }).click();
      for (const lighting of ['day', 'evening']) {
        await page.getByLabel('3Dの時間帯').selectOption(lighting);
        await expect(scene).toHaveAttribute('data-lighting', lighting);
        // Past the stage fade and the shader compiles of the lighting change.
        await page.waitForTimeout(2500);
        await page.evaluate(() => {
          const w = window as unknown as { suiGpuMs: number[]; suiMeasure: boolean };
          w.suiGpuMs = [];
          w.suiMeasure = true;
        });
        await page.waitForTimeout(8000);
        const times = await page.evaluate(() => {
          const w = window as unknown as { suiGpuMs: number[]; suiMeasure: boolean };
          w.suiMeasure = false;
          return w.suiGpuMs;
        });
        expect(times.length).toBeGreaterThan(20);
        const sorted = [...times].sort((a, b) => a - b);
        const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
        results.push({
          view: name,
          stage,
          lighting,
          frames: times.length,
          gpuMs: { p10: at(0.1), median: at(0.5), p90: at(0.9) },
          metrics: await scene.evaluate((element) => ({ ...(element as HTMLElement).dataset })),
        });
      }
      await page.getByRole('button', { name: 'UI表示', exact: true }).click();
      await page.getByRole('button', { name: next, exact: true }).click();
    }
    await page.unroute('**/sauna.scene.json');
  }
  await info.attach('gpu-time', {
    contentType: 'application/json',
    body: JSON.stringify({ browser: browser.version(), viewport: page.viewportSize(), results }, null, 2),
  });
});
