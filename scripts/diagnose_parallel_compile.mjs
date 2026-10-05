// Why a page's parallel shader compile (KHR_parallel_shader_compile) can take seconds while another
// page draws WebGL (docs/3d-qa/load-compile/README.md).
//
// node scripts/diagnose_parallel_compile.mjs <app url> <out.json> [repeat]
//
// <app url> is a served build (e.g. `bun run preview -- --port 4191`, then
// http://127.0.0.1:4191/sauna-simulator/). Each case opens a page A in one browser context (none,
// the 3D app, or a plain page drawing a heavy WebGL shader each frame), optionally recording a
// Playwright trace of A's context (screenshots = the DevTools screencast, snapshots = DOM
// snapshots), then loads the app in page B in another context and records, from an init script,
// when each linked program first reports COMPLETION_STATUS_KHR (or is waited for synchronously
// through getProgramInfoLog) and the app's data-load-ms / data-garden-ms. Page B uses
// ?temporal=off&resolution=fixed as temporal-aa.e2e.ts does. A small control (40 small programs
// on a blank page B) checks whether any program waits, not only the app's.
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [base, out, repeatArg] = process.argv.slice(2);
if (!base || !out) throw new Error('usage: diagnose_parallel_compile.mjs <app url> <out.json> [repeat]');
const REPEAT = Number(repeatArg ?? 2);
const app = (query) => `${base}?view=3d&frameRate=full&resolution=fixed${query}`;

const heavyPage = `<!doctype html><canvas width=1200 height=800 style="width:100vw;height:100vh"></canvas><script>
const gl = document.querySelector('canvas').getContext('webgl2');
const shader = (type, source) => { const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); return s; };
const p = gl.createProgram();
gl.attachShader(p, shader(gl.VERTEX_SHADER, '#version 300 es\\nvoid main(){vec2 q=vec2(gl_VertexID&1,gl_VertexID>>1)*4.-1.;gl_Position=vec4(q,0,1);}'));
gl.attachShader(p, shader(gl.FRAGMENT_SHADER, '#version 300 es\\nprecision highp float;out vec4 o;uniform float t;void main(){float a=0.;for(int i=0;i<3000;i++)a+=sin(gl_FragCoord.x*.01+float(i)+t);o=vec4(a*.001);}'));
gl.linkProgram(p); gl.useProgram(p);
const t = gl.getUniformLocation(p, 't');
const frame = (time) => { gl.uniform1f(t, time * 0.001); gl.drawArrays(gl.TRIANGLES, 0, 3); requestAnimationFrame(frame); };
requestAnimationFrame(frame);
</script>`;

// Page B: when each program links and completes.
const hook = () => {
  const P = WebGL2RenderingContext.prototype;
  const log = (window.__pc = { links: new Map(), done: new Map(), sync: [] });
  const link = P.linkProgram;
  P.linkProgram = function (p) {
    log.links.set(p, performance.now());
    return link.call(this, p);
  };
  const param = P.getProgramParameter;
  P.getProgramParameter = function (p, n) {
    const v = param.call(this, p, n);
    if (n === 0x91b1 && v && !log.done.has(p)) log.done.set(p, performance.now());
    return v;
  };
  const info = P.getProgramInfoLog;
  P.getProgramInfoLog = function (p) {
    const t = performance.now();
    const v = info.call(this, p);
    log.sync.push(performance.now() - t);
    if (!log.done.has(p)) log.done.set(p, performance.now());
    return v;
  };
};
const programs = (page) =>
  page.evaluate(() => {
    const l = window.__pc;
    const first = Math.min(...l.links.values());
    const done = [...l.links.keys()].map((p) => Math.round((l.done.get(p) ?? NaN) - first)).sort((a, b) => a - b);
    return {
      programs: done.length,
      firstDoneMs: done[0],
      medianDoneMs: done[done.length >> 1],
      lastDoneMs: done.at(-1),
      syncWaitMs: Math.round(l.sync.reduce((a, b) => a + b, 0)),
      syncWaitsOver5ms: l.sync.filter((d) => d > 5).length,
    };
  });

// The control: 40 small programs on a blank page.
const control = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const gl = document.createElement('canvas').getContext('webgl2');
        const ext = gl.getExtension('KHR_parallel_shader_compile');
        const shader = (type, source) => {
          const s = gl.createShader(type);
          gl.shaderSource(s, source);
          gl.compileShader(s);
          return s;
        };
        const seed = Math.random();
        const t0 = performance.now();
        const list = [];
        for (let k = 0; k < 40; k++) {
          let body = '';
          for (let i = 0; i < 120; i++)
            body += `a=sin(a*${(1.0001 + i * 0.013 + k * 0.0007 + seed).toFixed(6)}+p.x)+cos(a*p.y+${i + k}.0);\n`;
          const p = gl.createProgram();
          gl.attachShader(p, shader(gl.VERTEX_SHADER, '#version 300 es\nin vec4 v;void main(){gl_Position=v;}'));
          gl.attachShader(
            p,
            shader(
              gl.FRAGMENT_SHADER,
              `#version 300 es\nprecision highp float;out vec4 o;uniform vec2 p;void main(){float a=p.x;\n${body}o=vec4(a);}`,
            ),
          );
          gl.linkProgram(p);
          list.push(p);
        }
        const check = () => {
          const ms = performance.now() - t0;
          if (list.every((p) => gl.getProgramParameter(p, ext.COMPLETION_STATUS_KHR)) || ms > 30_000)
            resolve({ programs: 40, lastDoneMs: Math.round(ms) });
          else setTimeout(check, 10);
        };
        check();
      }),
  );

const CASES = [
  ['none', 'off', 'app'],
  ['app', 'off', 'app'],
  ['heavy', 'off', 'app'],
  ['app', 'snapshots', 'app'],
  ['app', 'screenshots', 'app'],
  ['heavy', 'screenshots', 'app'],
  ['heavy', 'screenshots', 'control'],
  ['none', 'off', 'control'],
];
const options = { viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1.5, reducedMotion: 'reduce' };
const browser = await chromium.launch({ channel: 'chrome' });
const rows = [];
for (let r = 0; r < REPEAT; r++) {
  for (const [a, trace, b] of CASES) {
    const ctxA = await browser.newContext(options);
    if (trace !== 'off')
      await ctxA.tracing.start({ screenshots: trace === 'screenshots', snapshots: trace === 'snapshots' });
    if (a === 'app') {
      const page = await ctxA.newPage();
      await page.goto(app(''));
      await page.getByRole('button', { name: '音なしで入室する' }).click();
      await page.locator('.sauna-3d-canvas[data-garden="ready"]').waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1_500);
    } else if (a === 'heavy') {
      const page = await ctxA.newPage();
      await page.setContent(heavyPage);
      await page.waitForTimeout(1_000);
    }
    const ctxB = await browser.newContext(options);
    const page = await ctxB.newPage();
    const row = { repeat: r, pageA: a, traceA: trace, pageB: b };
    if (b === 'app') {
      await page.addInitScript(hook);
      const started = Date.now();
      await page.goto(app('&temporal=off'));
      await page.getByRole('button', { name: '音なしで入室する' }).click();
      const scene = page.locator('.sauna-3d-canvas');
      await page.locator('.sauna-3d-canvas[data-garden="ready"]').waitFor({ timeout: 60_000 });
      Object.assign(row, {
        loadMs: Number(await scene.getAttribute('data-load-ms')),
        gardenMs: Number(await scene.getAttribute('data-garden-ms')),
        wallMs: Date.now() - started,
        ...(await programs(page)),
      });
    } else {
      await page.goto('about:blank');
      Object.assign(row, await control(page));
    }
    rows.push(row);
    console.log(JSON.stringify(row));
    if (trace !== 'off') await ctxA.tracing.stop();
    await ctxB.close();
    await ctxA.close();
  }
}
const version = browser.version();
await browser.close();
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
writeFileSync(
  out,
  JSON.stringify(
    {
      note: 'Times from page B: loadMs/gardenMs are the app attributes; *DoneMs from the first linkProgram to each program first reporting COMPLETION_STATUS_KHR (or a synchronous getProgramInfoLog). Page A runs in another context, traced as given.',
      browser: `Chrome ${version}`,
      app: base,
      script: hash(new URL(import.meta.url).pathname),
      rows,
    },
    null,
    1,
  ) + '\n',
);
