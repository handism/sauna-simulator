// A temporary build, never a product switch: draw at most N new heavy Metal pipelines per
// frame, then read back the canvas to drain the GPU queue before yielding to the browser.
// node scripts/diagnose_compile_batches.mjs <out.json> [cft|webkit] [conditions: 0,1,p0,p1,a1,ia1,fia1] [repeat]
// A "p" prefix first waits for each compiled program asynchronously and fetches its link info
// (three's onFirstUse) one program per frame, before any draw. "p0" then draws normally.
// An "a" prefix splits new draw states of every program, not only heavy materials.
// An "f" prefix waits for each step with a polled fence instead of a blocking 1-pixel readback.
// An "i" prefix submits only the first draw of each newly admitted state per step; states admitted
// earlier are suppressed instead of redrawn (the previous split redrew every admitted draw).
// Does not clear any caches. A fresh zero-valued uniform isolates each run's programs.
import { chromium, webkit } from 'playwright';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [out, engine = 'cft', batches = '0,1,p0,p1', repetitions = '2'] = process.argv.slice(2);
const sizes = batches.split(',');
const parse = (condition) => {
  const [, p, f, i, a, n] = condition.match(/^(p?)(f?)(i?)(a?)(\d+)$/) ?? [];
  return { prefetch: p === 'p', fence: f === 'f', incremental: i === 'i', all: a === 'a', batch: Number(n) };
};
const repeat = Number(repetitions);
if (
  !out ||
  !['cft', 'webkit'].includes(engine) ||
  new Set(sizes).size !== sizes.length ||
  !sizes.every((c) => /^p?(f?i?a[1-9]\d*|f?i?[1-9]\d*|0)$/.test(c)) ||
  !Number.isInteger(repeat) ||
  repeat < 1
)
  throw new Error('usage: <out.json> [cft|webkit] [0,1,p0,p1,a1,ia1,fia1] [repeat]');
const root = resolve('.');
const scratch = mkdtempSync(join(tmpdir(), 'sui-compile-batches-'));
for (const file of ['package.json', 'vite.config.ts', 'index.html']) cpSync(join(root, file), join(scratch, file));
cpSync(join(root, 'src'), join(scratch, 'src'), { recursive: true });
symlinkSync(join(root, 'public'), join(scratch, 'public'));
symlinkSync(join(root, 'node_modules'), join(scratch, 'node_modules'));
const scenePath = join(scratch, 'src/components/3d/SaunaScene.tsx');
const source = readFileSync(scenePath, 'utf8');
const scriptHash = createHash('sha256')
  .update(readFileSync(new URL(import.meta.url)))
  .digest('hex');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
const inputs = Object.fromEntries(
  execFileSync('git', ['ls-files', '-z', 'src', 'public/models'], { cwd: root })
    .toString()
    .split('\0')
    .filter(Boolean)
    .map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(join(root, file)))
        .digest('hex'),
    ]),
);
// Mark only the temporary source; every insertion must still match exactly once.
const mark = (phase) => `(window as any).__suiBatches.mark('${phase}');`;
let instrumented = source;
for (const [anchor, phase] of [
  ['        const get = createModelFetch(abort.signal);', 'fetch-body'],
  ['        const probes = createProbeTextures(irradiance, reflection);', 'prepare-probes'],
  ['        const gltf = await new GLTFLoader()', 'parse-body'],
  ['        prepare(gltf.scene);', 'prepare-body'],
  ['        for (let compiled: QualityMode | null', 'compile-body'],
  ['        setViewRef.current = setView;', 'first-view'],
  ['        const firstFrame = draw();', 'first-full-draw'],
  ['        onReady();', 'body-ready'],
  ["            const garden = await get('sauna-garden.glb')", 'fetch-garden'],
  ['            const { scene: woodland } = await new GLTFLoader()', 'parse-garden'],
  ['            gardenScenes.push(woodland);', 'prepare-garden'],
  ['            await output.compile(woodland, camera, scene);', 'compile-garden'],
  ['            scene.add(woodland);', 'add-garden'],
  ["            setGarden('ready');", 'garden-ready'],
]) {
  if (instrumented.split(anchor).length !== 2) throw new Error(`phase anchor changed: ${phase}`);
  instrumented = instrumented.replace(anchor, `${mark(phase)}\n${anchor}`);
}
// The ready attribute precedes its first draw. Record that draw separately too.
instrumented = instrumented.replace(
  '        const draw = () => {',
  `
        let gardenDrawn = false;
        const draw = () => {
          const firstGarden = gardenAdded === 1 && !gardenDrawn;
          if (firstGarden) (window as any).__suiBatches.mark('first-garden-draw');`,
);
instrumented = instrumented.replace(
  '          return stats;',
  `
          if (firstGarden) {
            gardenDrawn = true;
            (window as any).__suiBatches.mark('garden-drawn');
          }
          return stats;`,
);
const anchor = '        setViewRef.current = setView;\n        setView(stageRef.current);';
if (source.split(anchor).length !== 2) throw new Error('warmup insertion anchor changed');
writeFileSync(
  scenePath,
  instrumented
    .replace(
      'mirrorState[2] = gardenAdded;',
      'mirrorState[2] = (window as any).__suiBatches?.active ? performance.now() : gardenAdded;',
    )
    .replace(
      anchor,
      `
        // Diagnostic only. Partial images are hidden until the final full draw.
        const probe = (window as any).__suiBatches;
        if (probe?.prefetch) {
          // Programs created by compile(); passes first created by a draw are not in this list.
          probe.mark('prefetch');
          for (const program of [...(renderer.info.programs ?? [])] as any[]) {
            if (disposed || failed) return;
            const begin = performance.now();
            let frames = 0;
            // Non-blocking COMPLETION_STATUS poll; does not prove the Metal pipeline exists.
            while (!program.isReady() && frames < 600) {
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
              frames++;
            }
            const readyAt = performance.now();
            program.getUniforms();
            const end = performance.now();
            probe.prefetches.push({ program: probe.describe(program.program), start: begin, readyAt, end, frames, ms: end - readyAt });
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            await new Promise<void>((resolve) => setTimeout(resolve, 20));
          }
          if (!probe.batch) probe.mark('first-view');
        }
        if (probe?.batch) {
          const view = definition.views[stageRef.current];
          camera.position.fromArray(view.position);
          camera.lookAt(new THREE.Vector3().fromArray(view.target));
          camera.fov = view.fov;
          camera.updateProjectionMatrix();
          lighting.update(targetTime(), 0, true);
          probe.mark('batch-warmup');
          for (let step = 0; step < 400; step++) {
            if (disposed || failed) { probe.active = false; return; }
            probe.begin();
            draw();
            const pending = await probe.end(renderer.getContext());
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            await new Promise<void>((resolve) => setTimeout(resolve, 20));
            if (!pending) break;
          }
          probe.active = false;
          lighting.refreshShadows();
          output.resetTemporal();
          probe.mark('first-view');
        }
${anchor}`,
    ),
);
execFileSync('bun', ['run', 'build'], { cwd: scratch, stdio: 'inherit' });
const port = 4194;
const url = `http://127.0.0.1:${port}/sauna-simulator/`;
const server = spawn('bun', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: scratch,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (b) => {
  serverLog += b;
});
server.stderr.on('data', (b) => {
  serverLog += b;
});

function hook({ batch, prefetch, fence, incremental, all, nonce }) {
  const probe = (window.__suiBatches = {
    batch,
    prefetch,
    fence,
    incremental,
    all,
    skipped: 0,
    keyMismatches: [],
    prefetches: [],
    active: batch > 0,
    steps: [],
    seen: new Set(),
    admitted: 0,
    pending: false,
    phase: 'before-entry',
    events: [],
    intervals: [],
    slowCalls: [],
    programs: [],
    programQueries: [],
    recentDraws: [],
  });
  probe.mark = (phase) => {
    probe.phase = phase;
    probe.events.push({ at: performance.now(), phase });
  };
  probe.mark('before-entry');
  document.addEventListener(
    'click',
    (event) => {
      if (event.target.closest?.('button')?.textContent.includes('音なしで入室')) probe.mark('entry-click');
    },
    true,
  );
  const sources = new WeakMap(),
    shaders = new WeakMap(),
    heavy = new WeakMap(),
    ids = new WeakMap();
  const describe = (program) => {
    if (!program) return null;
    if (!ids.has(program)) {
      const text = (shaders.get(program) ?? []).map((shader) => sources.get(shader) ?? '').join('\n');
      const id = ++next;
      ids.set(program, id);
      heavy.set(program, text.length > 160000);
      probe.programs.push({
        id,
        chars: text.length,
        name: text.match(/#define SHADER_NAME ([^\r\n]+)/)?.[1] ?? 'unnamed',
        defines: [
          ...new Set([...text.matchAll(/^#define (SUI_\w+|USE_ALPHATEST|USE_SHADOWMAP)\b/gm)].map((match) => match[1])),
        ],
      });
    }
    return ids.get(program);
  };
  probe.describe = describe;
  const state = new WeakMap();
  let next = 0,
    started = 0,
    drawSequence = 0,
    stepDraws = [];
  const at = (gl) => {
    if (!state.has(gl))
      state.set(gl, {
        program: null,
        draw: null,
        read: null,
        renderbuffer: null,
        blend: false,
        src: gl.ONE,
        dst: gl.ZERO,
        depthMask: true,
        colorMask: [true, true, true, true],
        coverage: false,
      });
    return state.get(gl);
  };
  // Track the state the pipeline key needs in JavaScript. Querying it per draw costs a synchronous
  // round trip for every suppressed draw (~0.1s per step with ~500 draws), unlike a product warmup.
  const attachments = new WeakMap(),
    storage = new WeakMap();
  const p = WebGL2RenderingContext.prototype;
  const source = p.shaderSource;
  p.shaderSource = function (shader, text) {
    // Used in the fragment output so the generated Metal code has a fresh identity too.
    // Uniforms start at zero; this diagnostic adds zero to the output.
    if (this.getShaderParameter(shader, this.SHADER_TYPE) === this.FRAGMENT_SHADER) {
      text = text
        .replace(/void main\s*\(\s*\)\s*\{/, `uniform float ${nonce};\nvoid main() {`)
        .replace(/\}\s*$/, `gl_FragColor.a += ${nonce} * 1e-30;\n}`);
    }
    sources.set(shader, text);
    return source.call(this, shader, text);
  };
  const attachShader = p.attachShader;
  p.attachShader = function (program, shader) {
    shaders.set(program, [...(shaders.get(program) ?? []), shader]);
    return attachShader.call(this, program, shader);
  };
  const use = p.useProgram;
  p.useProgram = function (program) {
    at(this).program = program;
    return use.call(this, program);
  };
  const wrap = (name, after) => {
    const call = p[name];
    p[name] = function (...args) {
      const result = call.apply(this, args);
      after(this, at(this), ...args);
      return result;
    };
  };
  wrap('bindFramebuffer', (gl, s, target, fb) => {
    if (target !== gl.READ_FRAMEBUFFER) s.draw = fb;
    if (target !== gl.DRAW_FRAMEBUFFER) s.read = fb;
  });
  const attach = (gl, s, target, attachment, value) => {
    const fb = target === gl.READ_FRAMEBUFFER ? s.read : s.draw;
    if (!fb) return;
    if (!attachments.has(fb)) attachments.set(fb, new Map());
    const map = attachments.get(fb);
    for (const point of attachment === gl.DEPTH_STENCIL_ATTACHMENT
      ? [gl.DEPTH_ATTACHMENT, gl.STENCIL_ATTACHMENT]
      : [attachment])
      map.set(point, value);
  };
  wrap('framebufferTexture2D', (gl, s, target, attachment, _textarget, texture) =>
    attach(gl, s, target, attachment, texture ? gl.TEXTURE : gl.NONE),
  );
  wrap('framebufferTextureLayer', (gl, s, target, attachment, texture) =>
    attach(gl, s, target, attachment, texture ? gl.TEXTURE : gl.NONE),
  );
  wrap('framebufferRenderbuffer', (gl, s, target, attachment, _rbtarget, renderbuffer) =>
    attach(gl, s, target, attachment, renderbuffer ?? gl.NONE),
  );
  wrap('bindRenderbuffer', (_gl, s, _target, renderbuffer) => {
    s.renderbuffer = renderbuffer;
  });
  wrap('renderbufferStorage', (_gl, s, _target, format) => {
    if (s.renderbuffer) storage.set(s.renderbuffer, [format, 0]);
  });
  wrap('renderbufferStorageMultisample', (_gl, s, _target, samples, format) => {
    if (s.renderbuffer) storage.set(s.renderbuffer, [format, samples]);
  });
  for (const [name, value] of [
    ['enable', true],
    ['disable', false],
  ])
    wrap(name, (gl, s, cap) => {
      if (cap === gl.BLEND) s.blend = value;
      if (cap === gl.SAMPLE_ALPHA_TO_COVERAGE) s.coverage = value;
    });
  wrap('blendFunc', (_gl, s, src, dst) => Object.assign(s, { src, dst }));
  wrap('blendFuncSeparate', (_gl, s, src, dst) => Object.assign(s, { src, dst }));
  wrap('depthMask', (_gl, s, flag) => {
    s.depthMask = !!flag;
  });
  wrap('colorMask', (_gl, s, ...mask) => {
    s.colorMask = mask.map(Boolean);
  });
  const trackedKey = (gl, program) => {
    const s = at(gl);
    const formats = [];
    if (s.draw)
      for (const attachment of [gl.COLOR_ATTACHMENT0, gl.DEPTH_ATTACHMENT]) {
        const value = attachments.get(s.draw)?.get(attachment) ?? gl.NONE;
        formats.push(typeof value === 'number' ? value : (storage.get(value) ?? [gl.NONE, 0]));
      }
    return JSON.stringify([ids.get(program), formats, s.blend, s.src, s.dst, s.depthMask, s.colorMask, s.coverage]);
  };
  // The former per-draw key. Queried only to verify each newly admitted key (a few dozen per run).
  const queriedKey = (gl, program) => {
    const fb = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    const formats = [];
    if (fb)
      for (const attachment of [gl.COLOR_ATTACHMENT0, gl.DEPTH_ATTACHMENT]) {
        const type = gl.getFramebufferAttachmentParameter(
          gl.DRAW_FRAMEBUFFER,
          attachment,
          gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE,
        );
        if (type === gl.RENDERBUFFER) {
          const previous = gl.getParameter(gl.RENDERBUFFER_BINDING);
          gl.bindRenderbuffer(
            gl.RENDERBUFFER,
            gl.getFramebufferAttachmentParameter(
              gl.DRAW_FRAMEBUFFER,
              attachment,
              gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME,
            ),
          );
          formats.push([
            gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_INTERNAL_FORMAT),
            gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_SAMPLES),
          ]);
          gl.bindRenderbuffer(gl.RENDERBUFFER, previous);
        } else formats.push(type);
      }
    const key = JSON.stringify([
      ids.get(program),
      formats,
      gl.isEnabled(gl.BLEND),
      gl.getParameter(gl.BLEND_SRC_RGB),
      gl.getParameter(gl.BLEND_DST_RGB),
      gl.getParameter(gl.DEPTH_WRITEMASK),
      gl.getParameter(gl.COLOR_WRITEMASK),
      gl.isEnabled(gl.SAMPLE_ALPHA_TO_COVERAGE),
    ]);
    return key;
  };
  const allow = (gl) => {
    const program = at(gl).program;
    if (!program) return true;
    describe(program);
    if (!probe.active || !(probe.all || heavy.get(program))) return true;
    // Formats/samples rather than framebuffer identity: identical targets share Metal pipelines.
    const key = trackedKey(gl, program);
    if (probe.seen.has(key)) {
      if (!probe.incremental) return true;
      // Its pipeline already exists (admitted earlier, or earlier in this step): skip the redraw.
      probe.skipped++;
      return false;
    }
    if (probe.admitted >= batch) {
      probe.pending = true;
      return false;
    }
    const queried = queriedKey(gl, program);
    if (queried !== key) probe.keyMismatches.push({ tracked: key, queried });
    probe.seen.add(key);
    probe.admitted++;
    return true;
  };
  for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const draw = p[name];
    p[name] = function (...args) {
      if (!allow(this)) return;
      const entry = {
        sequence: ++drawSequence,
        program: describe(at(this).program),
        name,
        start: performance.now(),
        phase: probe.phase,
        step: probe.active ? probe.steps.length : null,
      };
      // Only actual submitted draws enter this history; suppressed calls do not.
      // No new GL queries here: correlation must not introduce another driver barrier.
      const result = draw.apply(this, args);
      entry.end = performance.now();
      probe.recentDraws.push(entry);
      if (probe.recentDraws.length > 8) probe.recentDraws.shift();
      if (probe.active) stepDraws.push(entry);
      return result;
    };
  }
  probe.begin = () => {
    started = performance.now();
    probe.admitted = 0;
    probe.pending = false;
    probe.skipped = 0;
    stepDraws = [];
  };
  probe.end = async (gl) => {
    const drawEnd = performance.now();
    let polls = null;
    if (probe.fence) {
      // Non-blocking: poll a fence once per frame instead of stalling the main thread on readback.
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      polls = 0;
      while (gl.getSyncParameter(sync, gl.SYNC_STATUS) !== gl.SIGNALED && polls < 1200) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        polls++;
      }
      gl.deleteSync(sync);
    }
    // The output pass leaves the canvas bound. Readback drains preceding draws, unlike finish()
    // on the tested ANGLE/Metal backend; this bounds the queue before the next frame.
    else gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    probe.steps.push({
      polls,
      start: started,
      drawMs: drawEnd - started,
      drainMs: performance.now() - drawEnd,
      end: performance.now(),
      ms: performance.now() - started,
      draws: stepDraws,
      newPipelines: probe.admitted,
      skippedDraws: probe.skipped,
      pending: probe.pending,
    });
    return probe.pending;
  };
  // Measure driver synchronization separately from JavaScript work and browser scheduling.
  // Wrapped after the draw hooks so timings also include state queries and draw suppression.
  for (const name of [
    'getParameter',
    'getProgramParameter',
    'getShaderParameter',
    'getProgramInfoLog',
    'getShaderInfoLog',
    'getActiveUniform',
    'getActiveAttrib',
    'getExtension',
    'getError',
    'texImage2D',
    'texImage3D',
    'bufferData',
    'renderbufferStorageMultisample',
    'blitFramebuffer',
    'getUniformLocation',
    'getAttribLocation',
    'getFramebufferAttachmentParameter',
    'getRenderbufferParameter',
    'checkFramebufferStatus',
    'readPixels',
    'getSyncParameter',
    'fenceSync',
    'finish',
    'drawElements',
    'drawArrays',
    'drawElementsInstanced',
    'drawArraysInstanced',
  ]) {
    const call = p[name];
    p[name] = function (...args) {
      const start = performance.now();
      const phase = probe.phase;
      const boundProgram = describe(at(this).program);
      const subjectProgram =
        name.startsWith('getProgram') ||
        ['getActiveUniform', 'getActiveAttrib', 'getUniformLocation', 'getAttribLocation'].includes(name)
          ? describe(args[0])
          : null;
      const precedingDraws = [...probe.recentDraws];
      try {
        return call.apply(this, args);
      } finally {
        const end = performance.now();
        if (name === 'getProgramInfoLog')
          probe.programQueries.push({ name, start, end, ms: end - start, phase, subjectProgram, precedingDraws });
        if (end - start > 100)
          probe.slowCalls.push({
            name,
            start,
            end,
            ms: end - start,
            phase,
            boundProgram,
            subjectProgram,
            precedingDraws,
          });
      }
    };
  }
  probe.gaps = [];
  const start = performance.now();
  let timerLast = start,
    rafLast = start;
  const interval = (kind, previous, now) => {
    if (now - previous > 100) {
      probe.intervals.push({ kind, start: previous, end: now, ms: now - previous, phase: probe.phase });
      if (kind === 'timer') probe.gaps.push(now - previous);
    }
  };
  const timer = setInterval(() => {
    const now = performance.now();
    interval('timer', timerLast, now);
    timerLast = now;
  }, 10);
  let raf;
  const frame = () => {
    const now = performance.now();
    interval('raf', rafLast, now);
    rafLast = now;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  probe.stop = () => {
    // Stop before snapshots/stage captures; they cannot contaminate the loading window.
    const now = performance.now();
    interval('timer', timerLast, now);
    interval('raf', rafLast, now);
    clearInterval(timer);
    cancelAnimationFrame(raf);
    probe.mark('measurement-end');
  };
}

const rows = [];
let browser;
let version;
try {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(serverLog);
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    if (i === 99) throw new Error('preview did not start');
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await (engine === 'cft' ? chromium : webkit).launch(engine === 'cft' ? { channel: 'chromium' } : {});
  version = browser.version();
  for (let round = 0; round < repeat; round++)
    for (const condition of round % 2 ? [...sizes].reverse() : sizes) {
      const { batch, prefetch, fence, incremental, all } = parse(condition);
      const context = await browser.newContext({
        viewport: { width: 1200, height: 800 },
        deviceScaleFactor: 1.5,
        reducedMotion: 'reduce',
      });
      const nonce = `sui${Date.now()}${condition}r${round}`;
      await context.addInitScript(hook, { batch, prefetch, fence, incremental, all, nonce });
      await context.addInitScript(() => {
        localStorage.setItem('sui-quality', 'standard');
        localStorage.setItem('sui-guide-dismissed', 'yes');
        localStorage.setItem('sui-lighting-mode', 'day');
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await page.goto(`${url}?view=3d&resolution=fixed&frameRate=full`);
      await page.getByRole('button', { name: '音なしで入室する' }).click();
      await page.locator('.sauna-3d-canvas[data-garden="ready"]').waitFor({ timeout: 60000 });
      await page.waitForTimeout(500);
      await page.evaluate(() => window.__suiBatches.stop());
      const row = await page.evaluate(() => ({
        data: { ...document.querySelector('.sauna-3d-canvas').dataset },
        steps: window.__suiBatches.steps,
        gaps: window.__suiBatches.gaps,
        events: window.__suiBatches.events,
        intervals: window.__suiBatches.intervals,
        slowCalls: window.__suiBatches.slowCalls,
        programs: window.__suiBatches.programs,
        programQueries: window.__suiBatches.programQueries,
        prefetches: window.__suiBatches.prefetches,
        pipelines: window.__suiBatches.seen.size,
        keyMismatches: window.__suiBatches.keyMismatches,
      }));
      row.condition = condition;
      row.batch = batch;
      row.prefetch = prefetch;
      row.fence = fence;
      row.incremental = incremental;
      row.all = all;
      row.round = round;
      row.nonce = nonce;
      row.errors = errors;
      row.stages = [];
      for (const [stage, button] of [
        ['sauna', null],
        ['water', '水風呂へ'],
        ['totonou', '外気浴へ'],
      ]) {
        if (button) {
          await page.getByRole('button', { name: button, exact: true }).click();
          await page.locator(`.sauna-3d-canvas[data-stage="${stage}"]`).waitFor();
        }
        await page.waitForTimeout(2000);
        const image = await page.locator('.sauna-3d-canvas canvas').screenshot({
          style:
            '.app-stage-container, .scene-mode-controls, .app-toolbar { visibility: hidden !important; transition: none !important; }',
        });
        const shots = resolve(out, '..', 'compile-batches-images');
        mkdirSync(shots, { recursive: true });
        const path = join(shots, `${engine}-${round}-${condition}-${stage}.png`);
        writeFileSync(path, image);
        row.stages.push({ stage, image: path, sha256: createHash('sha256').update(image).digest('hex') });
      }
      rows.push(row);
      console.log(
        JSON.stringify({
          condition,
          prefetched: row.prefetches.length,
          round,
          loadMs: row.data.loadMs,
          longestGap: Math.max(0, ...row.gaps),
          steps: row.steps.length,
          pipelines: row.pipelines,
          stepSum: Math.round(row.steps.reduce((sum, s) => sum + s.ms, 0)),
          keyMismatches: row.keyMismatches.length,
          errors,
        }),
      );
      if (errors.length || row.keyMismatches.length || row.steps.at(-1)?.pending)
        throw new Error('incomplete/errored diagnostic');
      await context.close();
    }
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  mkdirSync(resolve(out, '..'), { recursive: true });
  const hash = (s) => createHash('sha256').update(s).digest('hex');
  writeFileSync(
    out,
    JSON.stringify(
      {
        schema: 5,
        engine,
        version,
        revision,
        inputs,
        repeat,
        sizes,
        scratch,
        source: hash(source),
        script: scriptHash,
        temporarySource: hash(readFileSync(scenePath)),
        note: 'Fresh zero-valued output uniform per run; no cache deletion. Standard, 1200x800 DPR1.5, reduced motion. Heavy draws only unless an a-condition; i-conditions skip already admitted states. Instrumented, not product timings.',
        rows,
      },
      null,
      2,
    ) + '\n',
  );
}
