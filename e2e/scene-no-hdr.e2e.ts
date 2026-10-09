import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chooseSceneSetting, switchSceneMode } from './settings-controls';

async function configureNoHdr(page: Page, quality: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((quality) => {
    const getExtension: (this: WebGL2RenderingContext, name: string) => any =
      WebGL2RenderingContext.prototype.getExtension;
    WebGL2RenderingContext.prototype.getExtension = function (name: string) {
      return name === 'EXT_color_buffer_float' ? null : getExtension.call(this, name);
    };
    const supported = WebGL2RenderingContext.prototype.getSupportedExtensions;
    WebGL2RenderingContext.prototype.getSupportedExtensions = function () {
      return supported.call(this)?.filter((name) => name !== 'EXT_color_buffer_float') ?? null;
    };
    localStorage.setItem('sui-quality', quality);
    localStorage.setItem('sui-lighting-mode', 'day');
    localStorage.setItem('sui-guide-dismissed', 'yes');
  }, quality);
}

// Simulate missing float color buffers on desktop Chrome. This exercises the real LDR
// renderer, but does not establish compatibility or performance on non-HDR hardware.
for (const quality of ['low', 'standard', 'high']) {
  test(`split request without HDR renders and recovers at ${quality} quality`, async ({ page, browser }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await configureNoHdr(page, quality);
    await page.goto('?view=3d&warmup=split&frameRate=full&resolution=fixed');
    await page.getByRole('button', { name: '音なしで入室する' }).click();
    const scene = page.locator('.sauna-3d-canvas');
    const ready = async () => {
      await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 30_000 });
      await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
      await expect(scene).toHaveAttribute('data-warmup', 'off');
      await expect(scene).toHaveAttribute('data-temporal', 'off');
      await expect(scene).toHaveAttribute('data-quality', quality);
    };
    await ready();
    const original = await scene.locator('canvas').elementHandle();
    const capabilities = await original!.evaluate((canvas: HTMLCanvasElement) => {
      const gl = canvas.getContext('webgl2')!;
      return { float: !!gl.getExtension('EXT_color_buffer_float'), attributes: gl.getContextAttributes() };
    });
    expect(capabilities.float).toBe(false);
    expect(capabilities.attributes?.depth).toBe(true);
    expect(capabilities.attributes?.antialias).toBe(true);
    const samples = [];
    for (const [stage, button, lighting, time] of [
      ['sauna', '', 'day', '0.000'],
      ['water', '水風呂へ', 'evening', '1.000'],
      ['totonou', '外気浴へ', 'night', '2.000'],
    ]) {
      if (button) await page.getByRole('button', { name: button, exact: true }).click();
      await expect(scene).toHaveAttribute('data-stage', stage);
      await chooseSceneSetting(page, '3Dの時間帯', lighting);
      await expect(scene).toHaveAttribute('data-time-of-day', time);
      await expect(scene).toHaveAttribute('data-draw-calls', /^[1-9]\d*$/);
      await info.attach(`${quality}-${stage}`, { body: await scene.screenshot(), contentType: 'image/png' });
      samples.push(await scene.evaluate((element) => ({ ...(element as HTMLElement).dataset })));
    }
    expect(await original!.evaluate((canvas) => canvas === document.querySelector('.sauna-3d-canvas canvas'))).toBe(
      true,
    );
    expect(
      await original!.evaluate((canvas: HTMLCanvasElement) => {
        const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
        extension?.loseContext();
        return !!extension;
      }),
    ).toBe(true);
    await expect(page.getByRole('status')).toContainText('2Dで続けています');
    await expect(scene).toHaveCount(0);
    await page.getByRole('button', { name: 'もう一度サウナへ', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'サウナルーム' })).toBeVisible();
    await expect(page.locator('.sound-control')).toHaveAttribute('data-muted', 'true');
    await switchSceneMode(page, '2Dに切り替え');
    await switchSceneMode(page, '3Dを試す');
    await ready();
    await expect(scene).toHaveAttribute('data-stage', 'sauna');
    await expect(scene).toHaveAttribute('data-time-of-day', '2.000');
    await expect(page.locator('.sound-control')).toHaveAttribute('data-muted', 'true');
    expect(errors).toEqual([]);
    const hashes = Object.fromEntries(
      [
        'e2e/scene-no-hdr.e2e.ts',
        'e2e/settings-controls.ts',
        'playwright.config.ts',
        'src/components/3d/SaunaScene.tsx',
        'src/components/3d/hdrOutput.ts',
        'src/components/3d/sceneWarmup.ts',
        'src/components/SceneMode.tsx',
        'public/models/sauna.glb',
        'public/models/sauna-garden.glb',
        'bun.lock',
      ].map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]),
    );
    await info.attach('no-hdr', {
      contentType: 'application/json',
      body: JSON.stringify({
        quality,
        browser: browser.version(),
        capabilities,
        samples,
        errors,
        hashes,
        recovered: await scene.evaluate((element) => ({ ...(element as HTMLElement).dataset })),
      }),
    });
  });
}

// Hold only the first body request: exercise cancellation/deadline after the LDR
// renderer exists, then allow a real fresh load. This is not a slow-GPU simulation.
for (const action of ['cancel', 'timeout'] as const) {
  test(`non-HDR pending load ${action} preserves settings and permits retry`, async ({ page, browser }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await configureNoHdr(page, 'standard');
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let bodyRequests = 0;
    let gardenRequests = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/sauna.glb')) bodyRequests++;
      if (request.url().endsWith('/sauna-garden.glb')) gardenRequests++;
    });
    await page.route(
      '**/models/sauna.glb',
      async (route) => {
        await held;
        await route.continue().catch(() => {}); // The old request is aborted on teardown.
      },
      { times: 1 },
    );
    try {
      await page.goto('?view=3d&warmup=split&frameRate=full&resolution=fixed');
      const entered = Date.now();
      await page.getByRole('button', { name: '音なしで入室する' }).click();
      const scene = page.locator('.sauna-3d-canvas');
      await expect.poll(() => bodyRequests).toBe(1);
      await expect(page.getByRole('status')).toContainText('読み込み中');
      const oldCanvas = await scene.locator('canvas').elementHandle();
      expect(oldCanvas).not.toBeNull();
      expect(
        await oldCanvas!.evaluate(
          (canvas: HTMLCanvasElement) => canvas.getContext('webgl2')!.getExtension('EXT_color_buffer_float') === null,
        ),
      ).toBe(true);
      await chooseSceneSetting(page, '3Dの画質', 'low');
      await chooseSceneSetting(page, '3Dの画質', 'high');
      await chooseSceneSetting(page, '3Dの時間帯', 'evening');
      await chooseSceneSetting(page, '3Dの時間帯', 'night');
      await expect(page.getByRole('status')).toContainText('読み込み中');
      if (action === 'cancel') await switchSceneMode(page, '2Dに切り替え');
      else {
        await expect(page.getByRole('status')).toContainText('2Dで続けています', { timeout: 35_000 });
        expect(Date.now() - entered).toBeGreaterThanOrEqual(29_000);
      }
      const fallbackMs = Date.now() - entered;
      await expect(scene).toHaveCount(0);
      expect(gardenRequests).toBe(0);
      expect(
        await oldCanvas!.evaluate((canvas: HTMLCanvasElement) => canvas.getContext('webgl2')!.isContextLost()),
      ).toBe(true);
      release();
      await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
      await expect(page.getByRole('heading', { name: '水風呂', exact: true })).toBeVisible();
      await expect(scene).toHaveCount(0); // Late completion must not revive the scene.
      await expect(page.locator('.sound-control')).toHaveAttribute('data-muted', 'true');
      if (action === 'timeout') await switchSceneMode(page, '2Dに切り替え');
      await switchSceneMode(page, '3Dを試す');
      await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 30_000 });
      await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
      await expect(scene).toHaveAttribute('data-stage', 'water');
      await expect(scene).toHaveAttribute('data-quality', 'high');
      await expect(scene).toHaveAttribute('data-time-of-day', '2.000');
      await expect(scene).toHaveAttribute('data-warmup', 'off');
      await expect(scene).toHaveAttribute('data-temporal', 'off');
      await expect(scene).toHaveAttribute('data-draw-calls', /^[1-9]\d*$/);
      await expect(page.locator('.sound-control')).toHaveAttribute('data-muted', 'true');
      expect(bodyRequests).toBe(2);
      expect(gardenRequests).toBe(1);
      expect(errors).toEqual([]);
      await info.attach('no-hdr-loading', {
        contentType: 'application/json',
        body: JSON.stringify({
          action,
          browser: browser.version(),
          fallbackMs,
          bodyRequests,
          gardenRequests,
          errors,
          testSha256: createHash('sha256').update(readFileSync('e2e/scene-no-hdr.e2e.ts')).digest('hex'),
          recovered: await scene.evaluate((element) => ({ ...(element as HTMLElement).dataset })),
        }),
      });
    } finally {
      release();
    }
  });
}

// Delay the driver's completion notification only once garden compilation starts.
// Real GLB fetch/parse and shader linking still run; this is an async race test,
// not a measurement of compiler time or a simulation of a slow GPU.
for (const action of ['complete', 'cancel'] as const) {
  test(`non-HDR garden compile ${action} preserves latest settings`, async ({ page, browser }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await configureNoHdr(page, 'standard');
    await page.addInitScript(() => {
      const state = { hold: true, queries: 0 };
      Object.assign(window, { __noHdrCompile: state });
      const original = WebGL2RenderingContext.prototype.getProgramParameter;
      WebGL2RenderingContext.prototype.getProgramParameter = function (program, parameter) {
        if (
          parameter === 0x91b1 && // KHR_parallel_shader_compile.COMPLETION_STATUS_KHR
          state.hold &&
          document.querySelector<HTMLElement>('.sauna-3d-canvas')?.dataset.garden === 'loading'
        ) {
          state.queries++;
          return false;
        }
        return original.call(this, program, parameter);
      };
    });
    let bodyRequests = 0;
    let gardenRequests = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/sauna.glb')) bodyRequests++;
      if (request.url().endsWith('/sauna-garden.glb')) gardenRequests++;
    });
    await page.goto('?view=3d&warmup=split&frameRate=full&resolution=fixed');
    await page.getByRole('button', { name: '音なしで入室する' }).click();
    const scene = page.locator('.sauna-3d-canvas');
    await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => (window as any).__noHdrCompile.queries)).toBeGreaterThan(0);
    const original = await scene.locator('canvas').elementHandle();
    expect(
      await original!.evaluate((canvas: HTMLCanvasElement) =>
        canvas.getContext('webgl2')!.getExtension('EXT_color_buffer_float'),
      ),
    ).toBeNull();
    for (const [label, value] of [
      ['3Dの画質', 'low'],
      ['3Dの画質', 'high'],
      ['3Dの時間帯', 'evening'],
      ['3Dの時間帯', 'night'],
    ] as const) {
      await chooseSceneSetting(page, label, value);
      await expect(scene).toHaveAttribute('data-garden', 'loading');
    }
    await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
    await expect(scene).toHaveAttribute('data-stage', 'water');
    await expect(scene).toHaveAttribute('data-time-of-day', '2.000');
    await expect(scene).toHaveAttribute('data-garden', 'loading');
    const held = await page.evaluate(() => ({ ...(window as any).__noHdrCompile }));
    expect(held.hold).toBe(true);
    expect(held.queries).toBeGreaterThan(0);
    if (action === 'cancel') {
      await switchSceneMode(page, '2Dに切り替え');
      await expect(scene).toHaveCount(0);
      expect(
        await original!.evaluate((canvas: HTMLCanvasElement) => canvas.getContext('webgl2')!.isContextLost()),
      ).toBe(true);
    }
    await page.evaluate(() => {
      (window as any).__noHdrCompile.hold = false;
    });
    if (action === 'cancel') {
      await page.getByRole('button', { name: '外気浴へ', exact: true }).click();
      await expect(page.getByRole('heading', { name: '外気浴', exact: true })).toBeVisible();
      await expect(scene).toHaveCount(0);
      await switchSceneMode(page, '3Dを試す');
    }
    await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 30_000 });
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
    await expect(scene).toHaveAttribute('data-quality', 'high');
    await expect(scene).toHaveAttribute('data-time-of-day', '2.000');
    await expect(scene).toHaveAttribute('data-stage', action === 'cancel' ? 'totonou' : 'water');
    await expect(scene).toHaveAttribute('data-warmup', 'off');
    await expect(scene).toHaveAttribute('data-temporal', 'off');
    await expect(scene).toHaveAttribute('data-draw-calls', /^[1-9]\d*$/);
    await expect(page.locator('.sound-control')).toHaveAttribute('data-muted', 'true');
    expect(await original!.evaluate((canvas) => canvas === document.querySelector('.sauna-3d-canvas canvas'))).toBe(
      action === 'complete',
    );
    expect(bodyRequests).toBe(action === 'cancel' ? 2 : 1);
    expect(gardenRequests).toBe(action === 'cancel' ? 2 : 1);
    expect(errors).toEqual([]);
    await info.attach('no-hdr-compile', {
      contentType: 'application/json',
      body: JSON.stringify({
        action,
        browser: browser.version(),
        held,
        bodyRequests,
        gardenRequests,
        errors,
        testSha256: createHash('sha256').update(readFileSync('e2e/scene-no-hdr.e2e.ts')).digest('hex'),
        final: await scene.evaluate((element) => ({ ...(element as HTMLElement).dataset })),
      }),
    });
  });
}

// The body compile has a 1-second wait cap. Pause the browser clock so UI
// settings can be changed deterministically before that cap, without changing
// product timers. Native fetch, parse and shader compilation still execute.
for (const action of ['complete', 'cancel', 'timeout'] as const) {
  test(`non-HDR body compile ${action} preserves latest settings`, async ({ page, browser }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await configureNoHdr(page, 'standard');
    await page.clock.install({ time: new Date('2026-10-08T00:00:00Z') });
    await page.addInitScript(() => {
      const state = { hold: true, queries: 0, firstQueryMs: -1 };
      Object.assign(window, { __noHdrBodyCompile: state });
      const original = WebGL2RenderingContext.prototype.getProgramParameter;
      WebGL2RenderingContext.prototype.getProgramParameter = function (program, parameter) {
        const host = document.querySelector<HTMLElement>('.sauna-3d-canvas');
        if (parameter === 0x91b1 && state.hold && host && !host.hasAttribute('data-load-ms')) {
          if (state.queries++ === 0) state.firstQueryMs = performance.now();
          return false;
        }
        return original.call(this, program, parameter);
      };
    });
    let bodyRequests = 0;
    let gardenRequests = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/sauna.glb')) bodyRequests++;
      if (request.url().endsWith('/sauna-garden.glb')) gardenRequests++;
    });
    await page.goto('?view=3d&warmup=split&frameRate=full&resolution=fixed');
    await page.clock.pauseAt(new Date('2026-10-08T01:00:00Z'));
    // dispatchEvent avoids the pointer stability rAF wait while the clock is paused.
    await page.getByRole('button', { name: '音なしで入室する' }).dispatchEvent('click');
    const scene = page.locator('.sauna-3d-canvas');
    await expect
      .poll(
        async () => {
          await page.clock.runFor(50);
          return page.evaluate(() => (window as any).__noHdrBodyCompile.queries);
        },
        { timeout: 30_000, intervals: [50] },
      )
      .toBeGreaterThan(0);
    const original = await scene.locator('canvas').elementHandle();
    expect(
      await original!.evaluate((canvas: HTMLCanvasElement) =>
        canvas.getContext('webgl2')!.getExtension('EXT_color_buffer_float'),
      ),
    ).toBeNull();
    await page.locator('.display-settings > summary').dispatchEvent('click');
    const samples = [];
    for (const [label, value] of [
      ['3Dの画質', 'low'],
      ['3Dの画質', 'high'],
      ['3Dの時間帯', 'evening'],
      ['3Dの時間帯', 'night'],
    ] as const) {
      await page.getByLabel(label).selectOption(value);
      await page.clock.runFor(50);
      await expect(page.getByLabel(label)).toHaveValue(value);
      if (label === '3Dの画質') await expect(scene).toHaveAttribute('data-quality', value);
      await expect(scene).not.toHaveAttribute('data-load-ms');
      await expect(page.getByRole('status')).toContainText('読み込み中');
      expect(gardenRequests).toBe(0);
      samples.push(await scene.evaluate((element) => ({ ...(element as HTMLElement).dataset })));
    }
    const held = await page.evaluate(() => ({ ...(window as any).__noHdrBodyCompile, nowMs: performance.now() }));
    expect(held.hold).toBe(true);
    expect(held.queries).toBeGreaterThan(0);
    expect(held.nowMs - held.firstQueryMs).toBeGreaterThanOrEqual(200);
    expect(held.nowMs - held.firstQueryMs).toBeLessThan(1000);
    if (action === 'cancel') {
      await page.getByRole('button', { name: '2Dに切り替え', exact: true }).dispatchEvent('click');
      await expect(scene).toHaveCount(0);
      expect(
        await original!.evaluate((canvas: HTMLCanvasElement) => canvas.getContext('webgl2')!.isContextLost()),
      ).toBe(true);
    }
    await page.locator('.display-settings > summary').dispatchEvent('click');
    if (action !== 'timeout') {
      await page.evaluate(() => {
        (window as any).__noHdrBodyCompile.hold = false;
      });
    }
    const resumedAt = performance.now();
    await page.clock.resume();
    if (action === 'cancel') {
      // Advance through a real stage transition after releasing the old compile.
      await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
      await expect(page.getByRole('heading', { name: '水風呂', exact: true })).toBeVisible();
      await expect(scene).toHaveCount(0);
      expect(gardenRequests).toBe(0);
      await switchSceneMode(page, '3Dを試す');
    }
    await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 30_000 });
    const readyAfterResumeMs = performance.now() - resumedAt;
    const atReady = await page.evaluate(() => ({ ...(window as any).__noHdrBodyCompile, nowMs: performance.now() }));
    if (action === 'timeout') {
      // The completion signal stays false until readiness. Only the product's
      // bounded wait can advance this path; real timers run after resume.
      expect(atReady.hold).toBe(true);
      expect(atReady.queries).toBeGreaterThan(held.queries);
      expect(atReady.nowMs - atReady.firstQueryMs).toBeGreaterThanOrEqual(1000);
      await page.evaluate(() => {
        (window as any).__noHdrBodyCompile.hold = false;
      });
    }
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
    await expect(scene).toHaveAttribute('data-quality', 'high');
    await expect(scene).toHaveAttribute('data-time-of-day', '2.000');
    await expect(scene).toHaveAttribute('data-warmup', 'off');
    await expect(scene).toHaveAttribute('data-temporal', 'off');
    if (action !== 'cancel') await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
    await expect(scene).toHaveAttribute('data-stage', 'water');
    await expect(scene).toHaveAttribute('data-time-of-day', '2.000');
    await expect(scene).toHaveAttribute('data-draw-calls', /^[1-9]\d*$/);
    await expect(page.locator('.sound-control')).toHaveAttribute('data-muted', 'true');
    expect(await original!.evaluate((canvas) => canvas === document.querySelector('.sauna-3d-canvas canvas'))).toBe(
      action !== 'cancel',
    );
    expect(bodyRequests).toBe(action === 'cancel' ? 2 : 1);
    expect(gardenRequests).toBe(1);
    expect(errors).toEqual([]);
    await info.attach('no-hdr-body-compile', {
      contentType: 'application/json',
      body: JSON.stringify({
        action,
        browser: browser.version(),
        held,
        atReady,
        readyAfterResumeMs,
        samples,
        bodyRequests,
        gardenRequests,
        errors,
        testSha256: createHash('sha256').update(readFileSync('e2e/scene-no-hdr.e2e.ts')).digest('hex'),
        final: await scene.evaluate((element) => ({ ...(element as HTMLElement).dataset })),
      }),
    });
  });
}

// Hold decoded images before GLTFLoader can resolve body parseAsync. Native image
// decoding still runs; only its completion is delayed, without changing product code.
for (const action of ['complete', 'cancel'] as const) {
  test(`non-HDR body parse ${action} preserves latest settings`, async ({ page, browser }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await configureNoHdr(page, 'standard');
    await page.addInitScript(() => {
      const state = { hold: true, pending: 0, released: 0, release: () => {} };
      Object.assign(window, { __noHdrParse: state });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      state.release = () => {
        state.hold = false;
        release();
      };
      const original = window.createImageBitmap.bind(window);
      window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
        const bitmap = await original(...args);
        if (state.hold) {
          state.pending++;
          await gate;
          state.released++;
        }
        return bitmap;
      }) as typeof createImageBitmap;
    });
    let bodyRequests = 0;
    let gardenRequests = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/sauna.glb')) bodyRequests++;
      if (request.url().endsWith('/sauna-garden.glb')) gardenRequests++;
    });
    await page.goto('?view=3d&warmup=split&frameRate=full&resolution=fixed');
    await page.getByRole('button', { name: '音なしで入室する' }).click();
    const scene = page.locator('.sauna-3d-canvas');
    await expect
      .poll(() => page.evaluate(() => (window as any).__noHdrParse.pending), { timeout: 30_000 })
      .toBeGreaterThan(0);
    const original = await scene.locator('canvas').elementHandle();
    expect(
      await original!.evaluate((canvas: HTMLCanvasElement) =>
        canvas.getContext('webgl2')!.getExtension('EXT_color_buffer_float'),
      ),
    ).toBeNull();
    for (const [label, value] of [
      ['3Dの画質', 'low'],
      ['3Dの画質', 'high'],
      ['3Dの時間帯', 'evening'],
      ['3Dの時間帯', 'night'],
    ] as const) {
      await chooseSceneSetting(page, label, value);
      await expect(scene).not.toHaveAttribute('data-load-ms');
      expect(gardenRequests).toBe(0);
    }
    await expect(page.getByRole('status')).toContainText('読み込み中');
    const held = await page.evaluate(() => {
      const { hold, pending, released } = (window as any).__noHdrParse;
      return { hold, pending, released };
    });
    expect(held.hold).toBe(true);
    expect(held.pending).toBeGreaterThan(0);
    expect(held.released).toBe(0);
    if (action === 'cancel') {
      await switchSceneMode(page, '2Dに切り替え');
      await expect(scene).toHaveCount(0);
      expect(
        await original!.evaluate((canvas: HTMLCanvasElement) => canvas.getContext('webgl2')!.isContextLost()),
      ).toBe(true);
    }
    await page.evaluate(() => {
      (window as any).__noHdrParse.release();
    });
    if (action === 'cancel') {
      await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
      await expect(page.getByRole('heading', { name: '水風呂', exact: true })).toBeVisible();
      await expect(scene).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => (window as any).__noHdrParse.released)).toBe(held.pending);
      expect(gardenRequests).toBe(0);
      await switchSceneMode(page, '3Dを試す');
    }
    await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 30_000 });
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
    await expect(scene).toHaveAttribute('data-quality', 'high');
    await expect(scene).toHaveAttribute('data-time-of-day', '2.000');
    if (action === 'complete') await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
    await expect(scene).toHaveAttribute('data-stage', 'water');
    await expect(scene).toHaveAttribute('data-warmup', 'off');
    await expect(scene).toHaveAttribute('data-temporal', 'off');
    await expect(scene).toHaveAttribute('data-draw-calls', /^[1-9]\d*$/);
    await expect(page.locator('.sound-control')).toHaveAttribute('data-muted', 'true');
    expect(await original!.evaluate((canvas) => canvas === document.querySelector('.sauna-3d-canvas canvas'))).toBe(
      action === 'complete',
    );
    expect(bodyRequests).toBe(action === 'cancel' ? 2 : 1);
    expect(gardenRequests).toBe(1);
    expect(errors).toEqual([]);
    await info.attach('no-hdr-parse', {
      contentType: 'application/json',
      body: JSON.stringify({
        action,
        browser: browser.version(),
        held,
        bodyRequests,
        gardenRequests,
        errors,
        testSha256: createHash('sha256').update(readFileSync('e2e/scene-no-hdr.e2e.ts')).digest('hex'),
        final: await scene.evaluate((element) => ({ ...(element as HTMLElement).dataset })),
      }),
    });
  });
}
