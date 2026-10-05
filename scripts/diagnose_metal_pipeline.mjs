// When ANGLE's Metal backend compiles a WebGL program (docs/3d-qa/other-browsers/).
//
// node scripts/diagnose_metal_pipeline.mjs <out.json> [browsers]
//
// [browsers] is a comma list of cft (`playwright install chromium`) and webkit. Before each
// browser launch it deletes the Metal shader cache only that test browser uses (see
// diagnose_other_browsers.mjs), and every program has a random constant, so all compiles are cold.
// 1. Linked: 8 heavy programs are linked, KHR_parallel_shader_compile's COMPLETION_STATUS_KHR is
//    polled for 0 / 3 / 10 s, then each is drawn once (draw + readPixels) and timed.
// 2. Targets: 6 heavy programs are each drawn into a 1x1 RGBA8 target, an 800x600 RGBA16F 4x MSAA
//    target, the same with blending, and the 1x1 target again, each draw timed.
import { chromium, webkit } from 'playwright';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [out, list] = process.argv.slice(2);
if (!out) throw new Error('usage: diagnose_metal_pipeline.mjs <out.json> [browsers]');
const CACHE_DIR = execSync('getconf DARWIN_USER_CACHE_DIR').toString().trim();
const ENGINES = {
  cft: [chromium, { channel: 'chromium' }, 'com.google.chrome.for.testing.helper/com.apple.metal'],
  webkit: [webkit, {}, 'com.apple.WebKit.GPU+org.webkit.Playwright/com.apple.WebKit.GPU/com.apple.metal'],
};

// In the page: a context, and `count` heavy programs that differ from any compiled before.
const setup = () => {
  const gl = document.createElement('canvas').getContext('webgl2');
  gl.getExtension('EXT_color_buffer_float');
  const seed = Math.random();
  const shader = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return s;
  };
  window.__programs = (count) =>
    Array.from({ length: count }, (_, k) => {
      let body = '';
      for (let i = 0; i < 1500; i++)
        body += `a=sin(a*${(1.0001 + i * 0.013 + k * 0.0007 + seed).toFixed(6)}+p.x)+cos(a*p.y+${i + k}.0);\n`;
      const p = gl.createProgram();
      gl.attachShader(
        p,
        shader(
          gl.VERTEX_SHADER,
          '#version 300 es\nvoid main(){vec2 q=vec2(gl_VertexID&1,gl_VertexID>>1)*4.-1.;gl_Position=vec4(q,0,1);}',
        ),
      );
      gl.attachShader(
        p,
        shader(
          gl.FRAGMENT_SHADER,
          `#version 300 es\nprecision highp float;out vec4 o;uniform vec2 p;void main(){float a=p.x;\n${body}o=vec4(a);}`,
        ),
      );
      gl.linkProgram(p);
      return p;
    });
  window.__gl = gl;
};

const linked = (wait) =>
  new Promise((resolve) => {
    const gl = window.__gl;
    const ext = gl.getExtension('KHR_parallel_shader_compile');
    const t0 = performance.now();
    const programs = window.__programs(8).map((p) => ({ p, done: null }));
    const linkMs = Math.round(performance.now() - t0);
    const poll = () => {
      for (const x of programs)
        if (x.done === null && gl.getProgramParameter(x.p, ext.COMPLETION_STATUS_KHR))
          x.done = Math.round(performance.now() - t0);
      if (performance.now() - t0 < wait) return setTimeout(poll, 10);
      const pixel = new Uint8Array(4);
      const drawMs = programs.map(({ p }) => {
        const t = performance.now();
        gl.getProgramParameter(p, gl.LINK_STATUS);
        gl.useProgram(p);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return Math.round(performance.now() - t);
      });
      resolve({ wait, linkMs, completedMs: programs.map((x) => x.done), firstDrawMs: drawMs });
    };
    poll();
  });

const targets = () => {
  const gl = window.__gl;
  const framebuffer = (w, h, format, samples) => {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    for (const [attachment, internal] of [
      [gl.COLOR_ATTACHMENT0, format],
      [gl.DEPTH_ATTACHMENT, gl.DEPTH_COMPONENT24],
    ]) {
      const rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      if (samples) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, internal, w, h);
      else gl.renderbufferStorage(gl.RENDERBUFFER, internal, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, rb);
    }
    return f;
  };
  const small = framebuffer(1, 1, gl.RGBA8, 0);
  const large = framebuffer(800, 600, gl.RGBA16F, 4);
  const draw = (target, p, blend) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.useProgram(p);
    if (blend) gl.enable(gl.BLEND);
    else gl.disable(gl.BLEND);
    const t = performance.now();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.getError();
    return Math.round(performance.now() - t);
  };
  return window.__programs(6).map((p) => {
    gl.getProgramParameter(p, gl.LINK_STATUS);
    return {
      rgba8: draw(small, p, false),
      rgba16fMsaa4: draw(large, p, false),
      rgba16fMsaa4Blend: draw(large, p, true),
      rgba8Again: draw(small, p, false),
    };
  });
};

const rows = [];
const versions = {};
for (const name of (list ?? 'cft,webkit').split(',')) {
  const [type, launch, cache] = ENGINES[name];
  const run = async (body, arg) => {
    rmSync(join(CACHE_DIR, cache), { recursive: true, force: true });
    const browser = await type.launch(launch);
    versions[name] = browser.version();
    const page = await browser.newPage();
    await page.goto('about:blank');
    await page.evaluate(setup);
    const result = await page.evaluate(body, arg);
    await browser.close();
    return result;
  };
  for (const wait of [0, 3000, 10000]) {
    const row = { browser: name, test: 'linked', ...(await run(linked, wait)) };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  const row = { browser: name, test: 'targets', programs: await run(targets) };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
writeFileSync(
  out,
  JSON.stringify(
    {
      note: 'Heavy synthetic programs, cold Metal shader cache. linked: COMPLETION_STATUS_KHR times and the first draw (+readPixels) after waiting; targets: one draw per target/state, timed with getError.',
      versions,
      script: hash(new URL(import.meta.url).pathname),
      rows,
    },
    null,
    1,
  ) + '\n',
);
