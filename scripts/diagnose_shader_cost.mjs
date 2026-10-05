// What makes the material programs slow for ANGLE's Metal backend to compile on a first visit
// (docs/3d-qa/shader-cost/).
//
// node scripts/diagnose_shader_cost.mjs capture <app url> <sources.json> [quality]
// node scripts/diagnose_shader_cost.mjs measure <sources.json> <out.json> [browser] [variants]
// node scripts/diagnose_shader_cost.mjs attribute <app url> <out.json> [browser] [quality]
//
// capture: loads the 3D sauna in Chrome for Testing and saves every linked program's vertex and
// fragment source (three's resolved text) with its SHADER_NAME.
// measure: in a blank page of cft or webkit (`playwright install`), compiles chosen programs as
// captured and with parts removed (the variants below), each with a fresh uniform name in its output
// so the Metal shader cache never holds it, draws once into an 800x600 RGBA16F 4x MSAA target with
// blending (as the scene's HDR target) and times link → COMPLETION_STATUS_KHR and the first
// draw + readPixels (where the Metal compile happens). Each variant runs SUI_REPEAT times (3).
// attribute: loads the 3D sauna in cft or webkit, walks the stages, and records the WebGL calls
// over 20 ms (with the bound program and framebuffer) and each distinct draw state a Metal
// pipeline depends on (program, framebuffer attachments as format × samples, blend, depth write,
// alpha to coverage, color mask) with when it was first drawn. Chrome's WebGL finish() does not
// wait, so the slow calls are wherever the main thread next waits for the GPU process, not the
// draw that queued the compile. SUI_COLD=1 first deletes the browser's Metal shader cache (as
// diagnose_other_browsers.mjs). The state queries slow every draw: not the product's load time.
import { chromium, webkit } from 'playwright';
import { execSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [mode, ...args] = process.argv.slice(2);
const ENGINES = {
  cft: [chromium, { channel: 'chromium' }, 'com.google.chrome.for.testing.helper/com.apple.metal'],
  webkit: [webkit, {}, 'com.apple.WebKit.GPU+org.webkit.Playwright/com.apple.WebKit.GPU/com.apple.metal'],
};

// In the page: times every WebGL call and records the draw states.
const attributeHook = () => {
  const log = (window.__draws = { draws: [], start: 0, pipelines: new Map() });
  const sources = new WeakMap();
  const shaders = new WeakMap();
  const labels = new WeakMap();
  const storage = new WeakMap();
  const attachments = new WeakMap();
  const state = new WeakMap();
  const label = (p) => {
    if (!labels.has(p)) {
      const text = (shaders.get(p) ?? []).map((sh) => sources.get(sh) ?? '').join('\n');
      const name = /#define SHADER_NAME (.*)/.exec(text)?.[1] ?? '';
      const defines = [...new Set([...text.matchAll(/#define (SUI_\w+)/g)].map((m) => m[1]))];
      labels.set(p, `${name} | ${text.length} | ${defines.join(' ')}`);
    }
    return labels.get(p);
  };
  for (const P of [WebGL2RenderingContext.prototype]) {
    const wrap = (name, after) => {
      const f = P[name];
      P[name] = function (...args) {
        const v = f.apply(this, args);
        after.call(this, args, v);
        return v;
      };
    };
    const at = (gl) => {
      if (!state.has(gl)) state.set(gl, { program: null, fb: null, rb: null, tex: null });
      return state.get(gl);
    };
    wrap('shaderSource', ([sh, text]) => sources.set(sh, text));
    wrap('attachShader', ([p, sh]) => shaders.set(p, [...(shaders.get(p) ?? []), sh]));
    wrap('useProgram', function ([p]) {
      at(this).program = p;
    });
    wrap('bindFramebuffer', function ([target, fb]) {
      if (target !== this.READ_FRAMEBUFFER) at(this).fb = fb;
    });
    wrap('bindRenderbuffer', function ([, rb]) {
      at(this).rb = rb;
    });
    wrap('bindTexture', function ([target, tex]) {
      if (target === this.TEXTURE_2D) at(this).tex = tex;
    });
    wrap('renderbufferStorage', function ([, format]) {
      storage.set(at(this).rb, `${format}x1`);
    });
    wrap('renderbufferStorageMultisample', function ([, samples, format]) {
      storage.set(at(this).rb, `${format}x${samples}`);
    });
    wrap('texStorage2D', function ([, , format]) {
      storage.set(at(this).tex, `t${format}`);
    });
    wrap('texImage2D', function ([, level, format]) {
      if (level === 0) storage.set(at(this).tex, `t${format}`);
    });
    const attach = (fb, point, object) => attachments.set(fb, { ...(attachments.get(fb) ?? {}), [point]: object });
    wrap('framebufferRenderbuffer', function ([, point, , rb]) {
      attach(at(this).fb, point, rb);
    });
    wrap('framebufferTexture2D', function ([, point, , tex]) {
      attach(at(this).fb, point, tex);
    });
    wrap('framebufferTextureMultisampleEXT', function () {});
    const describe = (gl) => {
      const fb = at(gl).fb;
      if (!fb) return 'canvas';
      return Object.entries(attachments.get(fb) ?? {})
        .sort()
        .map(([point, object]) => `${point}:${storage.get(object) ?? '?'}`)
        .join(' ');
    };
    // Every call is timed; each draw records its state.
    const DRAWS = new Set(['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']);
    const SKIP = new Set(['isEnabled', 'getParameter', 'finish']);
    for (const name of Object.getOwnPropertyNames(P)) {
      const desc = Object.getOwnPropertyDescriptor(P, name);
      if (typeof desc.value !== 'function' || name === 'constructor' || SKIP.has(name)) continue;
      const f = P[name];
      P[name] = function (...args) {
        const t = performance.now();
        const v = f.apply(this, args);
        if (DRAWS.has(name)) {
          // The state a Metal pipeline (and ANGLE's function constants) depends on.
          const program = at(this).program;
          const key = [
            program ? label(program) : '',
            describe(this),
            this.isEnabled(this.BLEND)
              ? this.getParameter(this.BLEND_SRC_RGB) + '/' + this.getParameter(this.BLEND_DST_RGB)
              : '-',
            this.getParameter(this.DEPTH_WRITEMASK) ? 'z' : '-',
            this.isEnabled(this.SAMPLE_ALPHA_TO_COVERAGE) ? 'a2c' : '-',
            this.getParameter(this.COLOR_WRITEMASK).map(Number).join(''),
          ].join(' # ');
          if (!log.pipelines.has(key)) log.pipelines.set(key, Math.round(t - (log.start || t)));
        }
        const ms = performance.now() - t;
        if (!log.start) log.start = t;
        if (ms > 20) {
          const program = args[0] instanceof WebGLProgram ? args[0] : at(this).program;
          log.draws.push({
            call: name,
            t: Math.round(t - log.start),
            ms: Math.round(ms),
            program: program ? label(program) : '',
            target: describe(this),
            blend: this.isEnabled(this.BLEND),
          });
        }
        return v;
      };
    }
  }
};

if (mode === 'capture') {
  const [base, out, quality = 'standard'] = args;
  if (!base || !out) throw new Error('usage: capture <app url> <sources.json> [quality]');
  const browser = await chromium.launch({ channel: 'chromium' });
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1.5 });
  await context.addInitScript((q) => {
    try {
      localStorage.setItem('sui-quality', q);
      localStorage.setItem('sui-guide-dismissed', 'yes');
    } catch {}
  }, quality);
  await context.addInitScript(() => {
    const programs = (window.__programs = []);
    const sources = new WeakMap();
    const shaders = new WeakMap();
    for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const source = P.shaderSource;
      P.shaderSource = function (sh, text) {
        sources.set(sh, text);
        return source.call(this, sh, text);
      };
      const attach = P.attachShader;
      P.attachShader = function (p, sh) {
        shaders.set(p, [...(shaders.get(p) ?? []), [this.getShaderParameter(sh, this.SHADER_TYPE), sh]]);
        return attach.call(this, p, sh);
      };
      const link = P.linkProgram;
      P.linkProgram = function (p) {
        const parts = Object.fromEntries(
          (shaders.get(p) ?? []).map(([type, sh]) => [
            type === this.VERTEX_SHADER ? 'vertex' : 'fragment',
            sources.get(sh),
          ]),
        );
        const name = /#define SHADER_NAME (.*)/.exec(parts.fragment ?? '')?.[1] ?? '';
        programs.push({ name, ...parts });
        return link.call(this, p);
      };
    }
  });
  const page = await context.newPage();
  await page.goto(`${base}?view=3d&frameRate=full`);
  await page.getByRole('button', { name: '音なしで入室する' }).click();
  await page.locator('.sauna-3d-canvas[data-garden="ready"]').waitFor({ timeout: 120_000 });
  const programs = await page.evaluate(() => window.__programs);
  writeFileSync(out, JSON.stringify({ quality, programs }) + '\n');
  console.log(`${programs.length} programs`);
  await browser.close();
} else if (mode === 'measure') {
  const [file, out, name = 'cft', list] = args;
  if (!file || !out) throw new Error('usage: measure <sources.json> <out.json> [browser] [variants]');
  const { programs } = JSON.parse(readFileSync(file, 'utf8'));
  const repeat = Number(process.env.SUI_REPEAT ?? 3);
  // The heaviest captured program, or the one whose name contains SUI_PROGRAM.
  const pick = process.env.SUI_PROGRAM;
  const target = pick
    ? programs.find((p) => p.name.includes(pick))
    : [...programs].sort((a, b) => b.fragment.length - a.fragment.length)[0];
  // three has already replaced the light counts with numbers, so the variants edit the text.
  const noShadows = (f) =>
    f
      .replace(/getShadow\( spotShadowMap\[ \d+ \][^;]*?vSpotLightCoord\[ \d+ \] \)/g, '1.0')
      .replace(
        /suiSunShadow\( directLight\.color, directionalShadowMap[^;]*?vDirectionalShadowCoord\[ \d+ \] \)/g,
        '1.0',
      );
  // Spot lights after the first add nothing: their shadow and BRDF calls are dropped.
  const oneSpot = (f) =>
    f.replace(/(spotLight = spotLights\[ ([1-9]) \];[\s\S]*?)(\n[^\n]*RE_Direct\( directLight[^\n]*)/g, (m, head) =>
      head.replace(/getShadow\( spotShadowMap\[ \d+ \][^;]*?vSpotLightCoord\[ \d+ \] \)/, '1.0'),
    );
  const noRectAreas = (f) =>
    f.replace(/\n[^\n]*suiRectFormFactor\( geometryNormal, geometryPosition, rectCoords \);/g, '\n');
  // [name, (vertex, fragment) => [vertex, fragment]]
  const VARIANTS = {
    base: (v, f) => [v, f],
    noShadows: (v, f) => [v, noShadows(f)],
    oneSpot: (v, f) => [v, oneSpot(f)],
    oneSpotNoShadows: (v, f) => [v, noShadows(oneSpot(f))],
    noRectAreas: (v, f) => [v, noRectAreas(f)],
  };
  const names = (list ?? Object.keys(VARIANTS).join(',')).split(',');
  const [type, launch] = ENGINES[name];
  const browser = await type.launch(launch);
  const page = await browser.newPage();
  await page.setContent('<canvas></canvas>');
  await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    gl.getExtension('EXT_color_buffer_float');
    const ext = gl.getExtension('KHR_parallel_shader_compile');
    const fb = gl.createFramebuffer();
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.RGBA16F, 800, 600);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.DEPTH_COMPONENT24, 800, 600);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.viewport(0, 0, 800, 600);
    gl.enable(gl.DEPTH_TEST);
    const SAMPLERS = new Set([
      gl.SAMPLER_2D,
      gl.SAMPLER_3D,
      gl.SAMPLER_CUBE,
      gl.SAMPLER_2D_SHADOW,
      gl.SAMPLER_2D_ARRAY,
      gl.SAMPLER_2D_ARRAY_SHADOW,
      gl.SAMPLER_CUBE_SHADOW,
      gl.INT_SAMPLER_2D,
      gl.UNSIGNED_INT_SAMPLER_2D,
    ]);
    window.__compile = async (vertex, fragment) => {
      const shader = (t, s) => {
        const sh = gl.createShader(t);
        gl.shaderSource(sh, s);
        gl.compileShader(sh);
        return sh;
      };
      const p = gl.createProgram();
      const vs = shader(gl.VERTEX_SHADER, vertex);
      const fs = shader(gl.FRAGMENT_SHADER, fragment);
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      const t0 = performance.now();
      gl.linkProgram(p);
      while (ext && !gl.getProgramParameter(p, ext.COMPLETION_STATUS_KHR)) await new Promise((r) => setTimeout(r, 5));
      const linked = performance.now() - t0;
      if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        return {
          error: (gl.getProgramInfoLog(p) || gl.getShaderInfoLog(fs) || gl.getShaderInfoLog(vs) || '').slice(0, 400),
        };
      const t1 = performance.now();
      gl.useProgram(p);
      // Each sampler on its own unit: samplers of different types on one unit fail the draw.
      let unit = 0;
      for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
        const info = gl.getActiveUniform(p, i);
        if (!SAMPLERS.has(info.type)) continue;
        const base = info.name.replace(/\[0\]$/, '');
        for (let k = 0; k < info.size; k++)
          gl.uniform1i(gl.getUniformLocation(p, info.size > 1 ? `${base}[${k}]` : info.name), unit++);
      }
      gl.getError();
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const error = gl.getError();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, new Float32Array(4));
      const drawn = performance.now() - t1;
      gl.deleteProgram(p);
      return {
        linked: Math.round(linked),
        drawn: Math.round(drawn),
        units: unit,
        error: error || undefined,
        fragmentLength: fragment.length,
      };
    };
  });
  const rows = [];
  for (let r = 0; r < repeat; r++)
    for (const variant of names) {
      let [v, f] = VARIANTS[variant](target.vertex, target.fragment);
      // A uniform of a fresh name in the output: a program the Metal cache has never compiled.
      const seed = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
      f = f
        .replace(/\nvoid main\(\) \{/, `\nuniform float suiSeed${seed};\nvoid main() {`)
        .replace(/\}\s*$/, `\tgl_FragColor.a += suiSeed${seed} * 1e-30;\n}\n`);
      const result = await page.evaluate(([a, b]) => window.__compile(a, b), [v, f]);
      rows.push({ variant, repeat: r, ...result });
      if (r === 0 && variant !== 'base' && f.length >= target.fragment.length)
        throw new Error(`${variant} changed nothing`);
      console.log(JSON.stringify(rows.at(-1)));
    }
  writeFileSync(
    out,
    JSON.stringify({ browser: name, version: browser.version(), program: target.name, repeat, rows }, null, 1) + '\n',
  );
  await browser.close();
} else if (mode === 'attribute') {
  const [base, out, name = 'cft', quality = 'standard'] = args;
  if (!base || !out) throw new Error('usage: attribute <app url> <out.json> [browser] [quality]');
  const [type, launch, cache] = ENGINES[name];
  if (process.env.SUI_COLD === '1')
    rmSync(join(execSync('getconf DARWIN_USER_CACHE_DIR').toString().trim(), cache), { recursive: true, force: true });
  const browser = await type.launch(launch);
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
  await context.addInitScript(attributeHook);
  const page = await context.newPage();
  const started = Date.now();
  await page.goto(`${base}?view=3d&frameRate=full`);
  await page.getByRole('button', { name: '音なしで入室する' }).click();
  await page.locator('.sauna-3d-canvas[data-garden="ready"]').waitFor({ timeout: 300_000 });
  const stages = [['sauna', Date.now() - started]];
  for (const [stage, button] of [
    ['water', '水風呂へ'],
    ['totonou', '外気浴へ'],
  ]) {
    await page.getByRole('button', { name: button, exact: true }).click();
    await page.locator(`.sauna-3d-canvas[data-stage="${stage}"]`).waitFor({ timeout: 300_000 });
    await page.waitForTimeout(3_000);
    stages.push([stage, Date.now() - started]);
  }
  const { draws, pipelines } = await page.evaluate(() => ({
    draws: window.__draws.draws,
    pipelines: [...window.__draws.pipelines],
  }));
  const byTarget = {};
  for (const d of draws) byTarget[`${d.call} ${d.target}`] = (byTarget[`${d.call} ${d.target}`] ?? 0) + d.ms;
  writeFileSync(
    out,
    JSON.stringify(
      {
        browser: name,
        version: browser.version(),
        quality,
        cold: process.env.SUI_COLD === '1',
        stages,
        byTarget,
        draws,
        pipelines,
      },
      null,
      1,
    ) + '\n',
  );
  console.log(
    JSON.stringify({
      stages,
      byTarget,
      slow: draws.length,
      totalMs: draws.reduce((a, d) => a + d.ms, 0),
      pipelines: pipelines.length,
    }),
  );
  await browser.close();
} else throw new Error('usage: diagnose_shader_cost.mjs capture|measure|attribute ...');
