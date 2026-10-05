// Whether the 3D view loads and runs in Playwright's WebKit and Firefox (docs/3d-qa/other-browsers/).
//
// node scripts/diagnose_other_browsers.mjs <app url> <out.json> [shot dir] [browsers]
//
// <app url> is a served build (e.g. `bun run preview -- --port 4191`, then
// http://127.0.0.1:4191/sauna-simulator/). [browsers] is a comma list of chromium (installed
// Chrome), cft (`playwright install chromium`), webkit and firefox. For each browser and quality it enters the 3D sauna without sound,
// waits for the garden (or the 2D fallback), records the WebGL context (renderer, extensions the
// scene branches on), the canvas data-* metrics, console errors, the load-to-first-compile times,
// then walks the stages and records the metrics and an optional screenshot per stage. Each quality
// loads twice in a new browser: cold, then warm (the browser's shader cache).
// Playwright's WebKit is the WebKit engine, not Safari, and headless Firefox may not use the GPU.
import { chromium, firefox, webkit } from 'playwright';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [base, out, shots, list] = process.argv.slice(2);
if (!base || !out) throw new Error('usage: diagnose_other_browsers.mjs <app url> <out.json> [shot dir] [browsers]');
const CACHE_DIR = execSync('getconf DARWIN_USER_CACHE_DIR').toString().trim();
// [browser type, launch options, the Metal shader cache only this browser uses (SUI_COLD)].
const ENGINES = {
  chromium: [chromium, { channel: 'chrome' }, null],
  cft: [chromium, { channel: 'chromium' }, 'com.google.chrome.for.testing.helper/com.apple.metal'],
  webkit: [webkit, {}, 'com.apple.WebKit.GPU+org.webkit.Playwright/com.apple.WebKit.GPU/com.apple.metal'],
  firefox: [firefox, {}, null],
};
// SUI_COLD=1 (macOS): before each cold launch of webkit or cft (Playwright's Chrome for Testing),
// delete the Metal shader cache that only that browser's GPU process uses. It survives the browser,
// so without this only the first load ever compiles cold (a first visit). The warm load measures
// the refilled cache. The installed Chrome shares its cache with everyday browsing: never cleared.
// A changed shader (an unused uniform with a fresh name) did not reliably miss the cache.
const COLD = process.env.SUI_COLD === '1';
const names = (list ?? 'chromium,webkit,firefox').split(',');
if (shots) mkdirSync(shots, { recursive: true });

// Every WebGL context the page creates, when its programs complete, how long WebGL calls block
// the main thread, and the longest gaps in a 10 ms timer (a frozen page) after the first link.
const hook = () => {
  const log = (window.__probe = {
    contexts: [],
    links: 0,
    firstLink: 0,
    lastDone: 0,
    done: new Set(),
    calls: [],
    gaps: [],
  });
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = get.call(this, type, ...rest);
    if (ctx && /webgl/.test(type) && !log.contexts.some((c) => c.ctx === ctx)) log.contexts.push({ type, ctx });
    return ctx;
  };
  // Which program a slow call waited on: three's SHADER_NAME and the fragment shader's defines.
  const sources = new WeakMap();
  const shaders = new WeakMap();
  const label = (p) => {
    const text = (shaders.get(p) ?? []).map((sh) => sources.get(sh) ?? '').join('\n');
    const name = /#define SHADER_NAME (.*)/.exec(text)?.[1] ?? '?';
    const defines = [...new Set([...text.matchAll(/#define (SUI_\w+|USE_\w+|NUM_\w+ \d+)/g)].map((m) => m[1]))];
    return `${name} | ${text.length} | ${defines.join(' ')}`;
  };
  const timed = (P, name, after) => {
    const f = P[name];
    P[name] = function (...args) {
      const t = performance.now();
      const v = f.apply(this, args);
      const ms = performance.now() - t;
      if (ms > 5)
        log.calls.push([
          name,
          Math.round(t - (log.firstLink || t)),
          Math.round(ms),
          ms > 100 && args[0] instanceof WebGLProgram ? label(args[0]) : '',
        ]);
      after?.(args, v);
      return v;
    };
  };
  for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    const source = P.shaderSource;
    P.shaderSource = function (sh, text) {
      sources.set(sh, text);
      return source.call(this, sh, text);
    };
    const attach = P.attachShader;
    P.attachShader = function (p, sh) {
      shaders.set(p, [...(shaders.get(p) ?? []), sh]);
      return attach.call(this, p, sh);
    };
    timed(P, 'linkProgram', () => {
      log.links++;
      if (!log.firstLink) log.firstLink = performance.now();
    });
    timed(P, 'getProgramParameter', ([p, n], v) => {
      if ((n === 0x91b1 || n === 0x8b82) && v && !log.done.has(p)) {
        log.done.add(p);
        log.lastDone = performance.now();
      }
    });
    for (const name of [
      'getProgramInfoLog',
      'getShaderParameter',
      'getShaderInfoLog',
      'useProgram',
      'drawElements',
      'drawArrays',
      'readPixels',
      'finish',
    ])
      timed(P, name);
  }
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    if (log.firstLink && now - last > 100) log.gaps.push([Math.round(last - log.firstLink), Math.round(now - last)]);
    last = now;
  }, 10);
};
const contextInfo = (page) =>
  page.evaluate(() => {
    const live = window.__probe.contexts.filter((c) => !c.ctx.isContextLost());
    const c = live.at(-1);
    if (!c) return { contexts: window.__probe.contexts.length, live: 0 };
    const gl = c.ctx;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const has = (name) => gl.getSupportedExtensions().includes(name);
    return {
      contexts: window.__probe.contexts.length,
      live: live.length,
      type: c.type,
      version: gl.getParameter(gl.VERSION),
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      maxSamples: gl.getParameter(gl.MAX_SAMPLES),
      maxTextureUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxFragmentUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
      extensions: Object.fromEntries(
        [
          'EXT_color_buffer_float',
          'EXT_color_buffer_half_float',
          'EXT_float_blend',
          'OES_texture_float_linear',
          'KHR_parallel_shader_compile',
          'EXT_disjoint_timer_query_webgl2',
          'WEBGL_lose_context',
        ].map((n) => [n, has(n)]),
      ),
      links: window.__probe.links,
      programsDone: window.__probe.done.size,
      firstLinkToLastDoneMs: Math.round(window.__probe.lastDone - window.__probe.firstLink),
      // WebGL calls over 5 ms: [name, ms after the first link, duration, program over 100 ms];
      // summed by name.
      blockingMs: Object.fromEntries(
        Object.entries(window.__probe.calls.reduce((a, [n, , ms]) => ((a[n] = (a[n] ?? 0) + ms), a), {})),
      ),
      longestCalls: [...window.__probe.calls].sort((a, b) => b[2] - a[2]).slice(0, 12),
      // Timer gaps over 100 ms: [ms after the first link, gap].
      longestGaps: [...window.__probe.gaps].sort((a, b) => b[1] - a[1]).slice(0, 5),
    };
  });
const sceneData = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.sauna-3d-canvas');
    return el ? { ...el.dataset } : null;
  });
const STAGES = [
  ['sauna', null],
  ['water', '水風呂へ'],
  ['totonou', '外気浴へ'],
];

const rows = [];
const versions = {};
let browser;
for (const name of names) {
  const [type, launch, cache] = ENGINES[name];
  // A new browser per quality: the first load compiles cold, the second may reuse the browser's
  // shader cache (the qualities share most programs).
  for (const [quality, run] of (process.env.SUI_QUALITIES ?? 'low,standard,high').split(',').flatMap((q) => [
    [q, 'cold'],
    [q, 'warm'],
  ])) {
    if (run === 'cold') {
      if (COLD && cache) rmSync(join(CACHE_DIR, cache), { recursive: true, force: true });
      browser = await type.launch(launch);
    }
    versions[name] = browser.version();
    const context = await browser.newContext({
      viewport: { width: 1200, height: 800 },
      deviceScaleFactor: 1.5,
      reducedMotion: 'reduce',
    });
    await context.addInitScript((q) => {
      try {
        localStorage.setItem('sui-quality', q);
        localStorage.setItem('sui-guide-dismissed', 'yes');
      } catch {}
    }, quality);
    await context.addInitScript(hook);
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 400)));
    page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 400)}`));
    const row = { browser: name, quality, run, stages: [] };
    const started = Date.now();
    try {
      await page.goto(`${base}?view=3d&frameRate=full`);
      await page.getByRole('button', { name: '音なしで入室する' }).click();
      // Ready (the garden settled either way), or SceneMode's status says it fell back to 2D.
      let outcome = 'pending';
      for (const until = Date.now() + 60_000; outcome === 'pending' && Date.now() < until;) {
        if (await page.locator('.sauna-3d-canvas[data-garden="ready"], .sauna-3d-canvas[data-garden="failed"]').count())
          outcome = 'ready';
        else if (await page.getByRole('status').filter({ hasText: '2Dで続けています' }).count()) outcome = 'fallback';
        else await page.waitForTimeout(200);
      }
      row.outcome = outcome;
      row.wallMs = Date.now() - started;
      row.context = await contextInfo(page);
      if (outcome === 'ready') {
        for (const [stage, button] of STAGES) {
          if (button) {
            await page.getByRole('button', { name: button, exact: true }).click();
            await page.locator(`.sauna-3d-canvas[data-stage="${stage}"]`).waitFor({ timeout: 10_000 });
          }
          // Let the frame metrics fill (180 frames) and the view settle.
          await page.waitForTimeout(5_000);
          const data = await sceneData(page);
          row.stages.push({ stage, data });
          if (shots && run === 'cold') await page.screenshot({ path: join(shots, `${name}-${quality}-${stage}.png`) });
        }
        row.stillThreeD = (await page.locator('.sauna-3d-canvas').count()) > 0;
      } else {
        row.text = (await page.locator('body').innerText()).slice(0, 600);
        if (shots) await page.screenshot({ path: join(shots, `${name}-${quality}-${run}-fallback.png`) });
      }
    } catch (e) {
      row.error = String(e).slice(0, 600);
    }
    row.errors = errors;
    rows.push(row);
    console.log(JSON.stringify({ ...row, stages: row.stages.map((s) => [s.stage, s.data?.frameMeanMs]) }));
    await context.close();
    if (run === 'warm') await browser.close();
  }
}
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
writeFileSync(
  out,
  JSON.stringify(
    {
      cold: COLD,
      note: 'Playwright engines (webkit is not Safari). 1200x800, DPR 1.5, reduced motion, frameRate=full; quality from sui-quality. data = the canvas data-* metrics 5 s after each stage; context = the last live WebGL context.',
      versions,
      app: base,
      script: hash(new URL(import.meta.url).pathname),
      rows,
    },
    null,
    1,
  ) + '\n',
);
