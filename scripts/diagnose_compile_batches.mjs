// A temporary build, never a product switch: draw at most N new heavy Metal pipelines per
// frame, then read back the canvas to drain the GPU queue before yielding to the browser.
// node scripts/diagnose_compile_batches.mjs <out.json> [cft|webkit] [conditions: 0,1,p0,p1,a1,ia1,fia1,v1] [repeat]
// A "p" prefix first waits for each compiled program asynchronously and fetches its link info
// (three's onFirstUse) one program per frame, before any draw. "p0" then draws normally.
// An "a" prefix splits new draw states of every program, not only heavy materials.
// An "f" prefix waits for each step with a polled fence instead of a blocking 1-pixel readback.
// An "i" prefix submits only the first draw of each newly admitted state per step; states admitted
// earlier are suppressed instead of redrawn (the previous split redrew every admitted draw).
// A "v" condition hooks no draw: through three's own API it hides the heavy materials
// (material.visible), draws every pass once, then shows N heavy program/state groups per step,
// the water's mirror and the main pass in separate steps. The garden's new groups follow the same
// way before its first draw. Every condition logs where each new draw state is first submitted.
// A "b<ms>" suffix on a v condition (v1b50) yields to the browser only once the steps since the
// last yield took that long; cold steps still yield each time, cached ones run back to back.
// SUI_WARM=1 loads every condition twice with the same shader identity: cold, then cached.
// SUI_ENTRY=sauna|water|totonou enables 3D from that stage after entering in 2D.
// An "o" prefix on v (ov1b50) warms the HDR target without presenting partial images.
// An "m" after it (omv1b50) repeats the steps from every stage view, entry first, for the groups
// three has not yet drawn in that pass (mirror/main), then restores the camera.
// An "s" after m (omsv1b50) leaves out groups whose objects are all hidden in that view, and
// passes that can never draw a group: the mirror for objects below the water or off its layers
// (or with the mirror off), the main pass for mirror-only objects. Groups are re-collected per view.
// SUI_HOLD=1 captures the compositor before/during offscreen garden warmup (not timing data).
// SUI_QUALITY=low|standard|high and SUI_LIGHTING=day|evening|night choose the saved settings.
// Does not clear any caches. A fresh zero-valued uniform isolates each run's programs.
import { chromium, webkit } from 'playwright';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const [out, engine = 'cft', batches = '0,1,p0,p1', repetitions = '2'] = process.argv.slice(2);
const sizes = batches.split(',');
const parse = (condition) => {
  const [, o, m, s, v, b] = condition.match(/^(o?)(m?)(s?)v(\d+)(?:b(\d+))?$/) ?? [];
  const visibility = Number(v ?? 0);
  if (visibility)
    return {
      prefetch: false,
      fence: false,
      incremental: false,
      all: false,
      batch: 0,
      visibility,
      budget: Number(b ?? 0),
      offscreen: o === 'o',
      multi: m === 'm',
      selective: s === 's',
    };
  const [, p, f, i, a, n] = condition.match(/^(p?)(f?)(i?)(a?)(\d+)$/) ?? [];
  return {
    prefetch: p === 'p',
    fence: f === 'f',
    incremental: i === 'i',
    all: a === 'a',
    batch: Number(n),
    visibility,
    budget: 0,
    offscreen: false,
    multi: false,
    selective: false,
  };
};
const repeat = Number(repetitions);
const warm = process.env.SUI_WARM === '1';
const entry = process.env.SUI_ENTRY ?? 'sauna';
const hold = process.env.SUI_HOLD === '1';
const quality = process.env.SUI_QUALITY ?? 'standard';
const lighting = process.env.SUI_LIGHTING ?? 'day';
if (
  !out ||
  !['cft', 'webkit'].includes(engine) ||
  !['sauna', 'water', 'totonou'].includes(entry) ||
  !['low', 'standard', 'high'].includes(quality) ||
  !['day', 'evening', 'night'].includes(lighting) ||
  new Set(sizes).size !== sizes.length ||
  !sizes.every((c) => /^(p?(f?i?a[1-9]\d*|f?i?[1-9]\d*|0)|o?(ms?)?v[1-9]\d*(b[1-9]\d*)?)$/.test(c)) ||
  !Number.isInteger(repeat) ||
  repeat < 1
)
  throw new Error(
    'usage: [SUI_WARM=1 SUI_ENTRY=sauna SUI_HOLD=1 SUI_QUALITY=standard SUI_LIGHTING=day] <out.json> [cft|webkit] [0,v1b50,ov1b50,omv1b50,omsv1b50] [repeat]',
  );
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
// Only the temporary HDR module changes. The scene pass uses the exact same target/formats.
const outputPath = join(scratch, 'src/components/3d/hdrOutput.ts');
let temporaryOutput = readFileSync(outputPath, 'utf8');
const outputAnchor = '    hdr: true,\n';
if (temporaryOutput.split(outputAnchor).length !== 2) throw new Error('HDR warmup anchor changed');
temporaryOutput = temporaryOutput.replace(
  outputAnchor,
  `${outputAnchor}
    warm(scene: THREE.Scene, camera: THREE.Camera) {
      const previous = renderer.getRenderTarget();
      renderer.getDrawingBufferSize(size);
      if (target.width !== size.x || target.height !== size.y) target.setSize(size.x, size.y);
      try {
        renderer.setRenderTarget(target);
        return drawScene(scene, camera);
      } finally { renderer.setRenderTarget(previous); }
    },
    drainWarm() {
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, new Uint16Array(4));
    },
`,
);
writeFileSync(outputPath, temporaryOutput);
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
// The garden's warmup runs before the loop's first draw of it; the loop draws nothing meanwhile.
for (const [target, insertion] of [
  [
    '            scene.add(woodland);\n',
    `            if ((window as any).__suiBatches?.visibility) {
              (window as any).__suiBatches.warming = true;
              (window as any).__suiBatches.mark('garden-warmup');
              await warmup(woodland, 'garden');
              if ((window as any).__suiBatches.offscreen && (window as any).__suiBatches.hold)
                await (window as any).__suiBatches.capture('garden:restored');
              (window as any).__suiBatches.warming = false;
              if (disposed || failed) return;
            }
`,
  ],
  [
    '        renderer.setAnimationLoop((now) => {\n',
    `          if ((window as any).__suiBatches?.warming) return;
`,
  ],
]) {
  if (instrumented.split(target).length !== 2) throw new Error(`warmup anchor changed: ${target}`);
  instrumented = instrumented.replace(target, `${target}${insertion}`);
}
// Pause BEFORE adding the garden, and sample the last complete frame. The normal loop never
// draws with material visibility changed; offscreen warmup must keep this compositor image.
const gardenAnchor = '            scene.add(woodland);\n';
instrumented = instrumented.replace(
  gardenAnchor,
  `
            if ((window as any).__suiBatches?.visibility) {
              (window as any).__suiBatches.warming = true;
              if ((window as any).__suiBatches.offscreen && (window as any).__suiBatches.hold)
                await (window as any).__suiBatches.capture('garden:before');
            }
${gardenAnchor}`,
);
// The s condition tests the layers each pass renders.
for (const [line, names] of [
  ["import { createDepthPrepass } from './depthPrepass';", 'createDepthPrepass, PREPASS_LAYER'],
  ["import { createShadowMask } from './shadowMask';", 'createShadowMask, SHADOW_MASK_LAYER'],
]) {
  if (instrumented.split(line).length !== 2) throw new Error(`import changed: ${line}`);
  instrumented = instrumented.replace(line, line.replace(names.split(',')[0], names));
}
const mirrorImport =
  "import { createMirrorUniforms, createPlanarReflection, type PlanarReflection } from './planarReflection';";
if (instrumented.split(mirrorImport).length !== 2) throw new Error('mirror import changed');
instrumented = instrumented.replace(
  mirrorImport,
  mirrorImport.replace('createMirrorUniforms,', 'createMirrorUniforms, MIRROR_LAYER,'),
);
instrumented = instrumented.replace(
  '    element.appendChild(renderer.domElement);',
  "    element.style.visibility = 'hidden';\n    element.appendChild(renderer.domElement);",
);
instrumented = instrumented.replace('        onReady();', "        element.style.visibility = '';\n        onReady();");
instrumented = instrumented.replace(
  '    const output = createHdrOutput(renderer);',
  "    const output = createHdrOutput(renderer);\n    setData('hdr', String(output.hdr));",
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
        // No WebGL hook is needed from here: programs, their source lengths and the materials come
        // from three, and only material.visible chooses what each step draws.
        // Without m: a group counts as warmed once stepped. With m: per pass, only once three
        // reported drawing one of its materials there (onBeforeRender, which shows the material
        // actually drawn: never an override, a depth copy or a frustum-culled mesh).
        const warmed = new Set<string>();
        // s: the passes that can ever draw each group, from the objects seen so far.
        const needs = new Map<string, Set<string>>();
        let mirrorShown = true;
        const warmup = async (root: THREE.Object3D, label: string) => {
          const gl = renderer.getContext();
          if (probe.offscreen && !output.hdr) throw new Error('offscreen warmup requires HDR');
          const stages = ['sauna', 'water', 'totonou'] as const;
          const current = stageRef.current;
          const views = probe.multi ? [current, ...stages.filter((s) => s !== current)] : [current];
          const saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov };
          // The materials and the shadow mask's (about 73,000 characters, ~0.13 s a pipeline).
          const heavy = (program: any) =>
            (gl.getShaderSource(program.vertexShader)?.length ?? 0) +
              (gl.getShaderSource(program.fragmentShader)?.length ?? 0) >
            60000;
          const materialsOf = (child: THREE.Object3D) => {
            const material = (child as THREE.Mesh).material;
            return Array.isArray(material) ? material : material ? [material] : [];
          };
          // A Metal pipeline per program and the material state of the draw (blend, writes).
          const keyOf = new Map<THREE.Material, string>();
          root.traverse((child) => {
            for (const each of materialsOf(child)) {
              const program = (renderer.properties.get(each) as any).currentProgram;
              if (!program || !each.visible || !heavy(program)) continue;
              keyOf.set(
                each,
                [
                  program.id,
                  each.transparent,
                  each.blending,
                  each.blendSrc,
                  each.blendDst,
                  each.blendEquation,
                  each.premultipliedAlpha,
                  each.depthWrite,
                  each.colorWrite,
                  each.alphaToCoverage,
                ].join(),
              );
            }
          });
          // The layers each pass renders: the main pass its depth copies (drawScene), then the
          // camera's; the mirror its camera's (layer 0 and the mirror layer). With the shadow mask
          // on, both also render its depth copies and its own copies (shadowMask.render). The
          // mirror's near plane is the water surface (obliqueClip): objects whose bounding sphere
          // lies below are always culled there.
          const mainLayers = new THREE.Layers();
          mainLayers.mask = camera.layers.mask;
          mainLayers.enable(PREPASS_LAYER);
          const mirrorLayers = new THREE.Layers();
          mirrorLayers.enable(MIRROR_LAYER);
          if (masked())
            for (const layers of [mainLayers, mirrorLayers]) {
              layers.enable(PREPASS_LAYER);
              layers.enable(SHADOW_MASK_LAYER);
            }
          const mirrorOn = !!mirror && mirror.size !== '0x0';
          const level = definition.water.center[1];
          const sphere = new THREE.Sphere();
          const passesOf = (child: THREE.Object3D) => {
            const passes = [];
            if (child.layers.test(mainLayers)) passes.push('main');
            if (mirrorOn && child.layers.test(mirrorLayers)) {
              const bounded = (child as any).isInstancedMesh || (child as any).isBatchedMesh ? child : (child as any).geometry;
              if (child.frustumCulled && bounded) {
                if (bounded.boundingSphere === null) bounded.computeBoundingSphere();
                sphere.copy(bounded.boundingSphere).applyMatrix4(child.matrixWorld);
              }
              if (!child.frustumCulled || !bounded || sphere.center.y + sphere.radius > level) passes.push('mirror');
            }
            return passes;
          };
          const done = (key: string) =>
            !probe.multi
              ? warmed.has(key)
              : probe.selective
                ? // A group no pass can draw is never done (the summary rejects it).
                  !!needs.get(key)?.size && [...needs.get(key)!].every((p) => warmed.has(p + '|' + key))
                : warmed.has('main|' + key) && warmed.has('mirror|' + key);
          // Without s, once before the first view, from every object; with s, per view, from the
          // objects visible there (side images change with the view).
          const collect = () => {
            const groups = new Map<string, THREE.Material[]>();
            const visit = (child: THREE.Object3D) => {
              const passes = probe.selective ? passesOf(child) : null;
              for (const each of materialsOf(child)) {
                const key = keyOf.get(each);
                if (!key) continue;
                if (passes) {
                  const set = needs.get(key) ?? new Set<string>();
                  for (const pass of passes) set.add(pass);
                  needs.set(key, set);
                }
              }
              for (const each of materialsOf(child)) {
                const key = keyOf.get(each);
                if (!key || done(key)) continue;
                const list = groups.get(key) ?? [];
                if (!list.includes(each)) list.push(each);
                groups.set(key, list);
              }
            };
            if (probe.selective) root.traverseVisible(visit);
            else root.traverse(visit);
            return groups;
          };
          let groups = collect();
          // Hidden per step: without s the first collection's materials, with s every candidate.
          const split = probe.selective ? [...keyOf.keys()] : [...groups.values()].flat();
          const show = (shown: THREE.Material[]) => {
            for (const each of split) each.visible = shown.includes(each);
          };
          let pass: 'main' | 'mirror' | null = null;
          const hooked: [THREE.Object3D, boolean, THREE.Object3D['onBeforeRender']][] = [];
          if (probe.multi)
            root.traverse((child) => {
              if (!materialsOf(child).some((m) => keyOf.has(m) && (probe.selective || groups.has(keyOf.get(m)!))))
                return;
              const own = Object.prototype.hasOwnProperty.call(child, 'onBeforeRender');
              const original = child.onBeforeRender;
              hooked.push([child, own, original]);
              child.onBeforeRender = function (this: THREE.Object3D, ...args: any[]) {
                const key = keyOf.get(args[4]);
                if (pass && key) warmed.add(pass + '|' + key);
                return (original as any).apply(this, args);
              };
            });
          const mirrorPass = () => {
            if (!mirror || !mirrorShown) return false;
            pass = 'mirror';
            try {
              mirrorShown = mirror.render(scene, camera, waterEffects.surface, [performance.now()]).rendered;
            } finally { pass = null; }
            return mirrorShown;
          };
          const mainPass = () => {
            pass = 'main';
            try {
              if (masked()) {
                renderer.getDrawingBufferSize(drawingSize);
                shadowMask!.render(scene, camera, drawingSize.x, drawingSize.y);
              }
              if (probe.offscreen) (output as any).warm(scene, camera);
              else output.render(scene, camera);
              shadowMask?.end();
            } finally { pass = null; }
            return true;
          };
          let slice = performance.now();
          const step = async (name: string, pass: () => boolean) => {
            if (disposed || failed) return;
            probe.begin();
            // A pass that drew nothing (the mirror out of view) does not wait for the GPU.
            if (!pass()) return;
            await probe.end(gl, name, probe.offscreen ? () => (output as any).drainWarm() : null);
            // Without a budget every step yields; with one, quick (cached) steps run back to back.
            const yielded = !probe.budget || performance.now() - slice >= probe.budget;
            probe.steps.at(-1).yielded = yielded;
            if (!yielded) return;
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            await new Promise<void>((resolve) => setTimeout(resolve, 20));
            if (probe.offscreen && probe.hold && label === 'garden') await probe.capture(name);
            slice = performance.now();
          };
          probe.recording = true;
          try {
            for (const stage of views) {
              // The preparation's camera reaches neither the audio nor the canvas (no setView()).
              const view = definition.views[stage];
              camera.position.fromArray(view.position);
              camera.lookAt(new THREE.Vector3().fromArray(view.target));
              camera.fov = view.fov;
              camera.updateProjectionMatrix();
              const prefix = probe.multi ? label + ':' + stage : label;
              mirrorShown = true;
              show([]);
              sideImages.update(camera);
              if (probe.selective) groups = collect();
              await step(prefix + ':mirror:rest', mirrorPass);
              await step(prefix + ':main:rest', mainPass);
              // s: groups no pass renders (the shadow mask's copies with the mask off) are only
              // recorded; the product draws them only after a settings change.
              const unreachable = probe.selective ? [...groups.keys()].filter((key) => !needs.get(key)?.size) : [];
              const entries = [...groups.entries()].filter(
                ([key]) => (!probe.multi || !done(key)) && !unreachable.includes(key),
              );
              // s: a pass is stepped only when a group of the chunk still needs it there.
              const wants = (chunk: typeof entries, p: string) =>
                !probe.selective || chunk.some(([key]) => needs.get(key)?.has(p) && !warmed.has(p + '|' + key));
              for (let i = 0; i < entries.length; i += probe.visibility) {
                const chunk = entries.slice(i, i + probe.visibility);
                show(chunk.flatMap(([, materials]) => materials));
                const names = chunk.map(([key]) => key.split(',')[0]).join('+');
                if (wants(chunk, 'mirror')) await step(prefix + ':mirror:' + names, mirrorPass);
                if (wants(chunk, 'main')) await step(prefix + ':main:' + names, mainPass);
                if (!probe.multi) for (const [key] of chunk) warmed.add(key);
              }
              probe.groups.push({
                label,
                view: stage,
                groups: entries.map(([key, materials]) => ({
                  key,
                  materials: materials.map((m) => m.name),
                  // Passes that drew the group by the end of this view (m only).
                  drawn: probe.multi ? ['main', 'mirror'].filter((p) => warmed.has(p + '|' + key)) : null,
                  // Passes that can draw it, from the objects visible so far (s only).
                  needs: probe.selective ? [...(needs.get(key) ?? [])].sort() : null,
                })),
                unreachable: unreachable.map((key) => ({ key, materials: groups.get(key)!.map((m) => m.name) })),
              });
              if (disposed || failed) break;
            }
          } finally {
            for (const each of split) each.visible = true;
            for (const [child, own, original] of hooked)
              if (own) child.onBeforeRender = original;
              else delete (child as any).onBeforeRender;
            camera.position.copy(saved.position);
            camera.quaternion.copy(saved.quaternion);
            camera.fov = saved.fov;
            camera.updateProjectionMatrix();
            probe.recording = false;
          }
        };
        if (probe?.visibility) {
          const view = definition.views[stageRef.current];
          camera.position.fromArray(view.position);
          camera.lookAt(new THREE.Vector3().fromArray(view.target));
          camera.fov = view.fov;
          camera.updateProjectionMatrix();
          lighting.update(targetTime(), 0, true);
          probe.mark('visibility-warmup');
          await warmup(scene, 'body');
          if (disposed || failed) return;
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

function hook({
  batch,
  prefetch,
  fence,
  incremental,
  all,
  visibility,
  budget,
  offscreen,
  multi,
  selective,
  hold,
  nonce,
}) {
  const probe = (window.__suiBatches = {
    batch,
    multi,
    selective,
    visibility,
    budget,
    offscreen,
    hold,
    recording: false,
    warming: false,
    groups: [],
    newKeys: [],
    stepNewKeys: 0,
    stepNewHeavyKeys: 0,
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
    presentationWrites: [],
  });
  probe.mark = (phase) => {
    probe.phase = phase;
    probe.events.push({ at: performance.now(), phase });
  };
  probe.mark('before-entry');
  probe.capture = async (label) => {
    // Explicitly yield across compositor frames before sampling; screenshot costs are excluded
    // from performance conclusions in SUI_HOLD runs, not silently subtracted from intervals.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 100));
    await window.__suiCapture(label);
  };
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
  const drawnKeys = new Set();
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
      const stepping = probe.active || probe.recording;
      const entry = {
        sequence: ++drawSequence,
        program: describe(at(this).program),
        name,
        start: performance.now(),
        phase: probe.phase,
        step: stepping ? probe.steps.length : null,
        canvas: at(this).draw === null,
      };
      if (probe.warming && entry.canvas) probe.presentationWrites.push({ phase: probe.phase, at: entry.start });
      // Where each draw state is first submitted (tracked in JS, as the gate's key; no query).
      const key = trackedKey(this, at(this).program);
      if (!drawnKeys.has(key)) {
        drawnKeys.add(key);
        const isHeavy = heavy.get(at(this).program) === true;
        probe.newKeys.push({
          at: entry.start,
          phase: probe.phase,
          step: entry.step,
          program: entry.program,
          heavy: isHeavy,
          key,
        });
        if (stepping) {
          probe.stepNewKeys++;
          if (isHeavy) probe.stepNewHeavyKeys++;
        }
      }
      // Only actual submitted draws enter this history; suppressed calls do not.
      // No new GL queries here: correlation must not introduce another driver barrier.
      const result = draw.apply(this, args);
      entry.end = performance.now();
      probe.recentDraws.push(entry);
      if (probe.recentDraws.length > 8) probe.recentDraws.shift();
      if (stepping) stepDraws.push(entry);
      return result;
    };
  }
  probe.begin = () => {
    started = performance.now();
    probe.admitted = 0;
    probe.pending = false;
    probe.skipped = 0;
    probe.stepNewKeys = 0;
    probe.stepNewHeavyKeys = 0;
    stepDraws = [];
  };
  probe.end = async (gl, label = null, drain = null) => {
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
    else if (drain) drain();
    else gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    probe.steps.push({
      label,
      newKeys: probe.stepNewKeys,
      newHeavyKeys: probe.stepNewHeavyKeys,
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
  probe.startWindow = () => {
    probe.events = [];
    probe.intervals = [];
    probe.gaps = [];
    timerLast = rafLast = performance.now();
    probe.mark('before-entry');
  };
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
      const nonce = `sui${Date.now()}${condition}r${round}`;
      // The cached load reuses the cold load's shader identity in the same browser process.
      for (const cached of warm ? [false, true] : [false]) {
        const { batch, prefetch, fence, incremental, all, visibility, budget, offscreen, multi, selective } =
          parse(condition);
        const context = await browser.newContext({
          viewport: { width: 1200, height: 800 },
          deviceScaleFactor: 1.5,
          reducedMotion: 'reduce',
        });
        await context.addInitScript(hook, {
          batch,
          prefetch,
          fence,
          incremental,
          all,
          visibility,
          budget,
          offscreen,
          multi,
          selective,
          hold,
          nonce,
        });
        await context.addInitScript(
          ([quality, lighting]) => {
            localStorage.setItem('sui-quality', quality);
            localStorage.setItem('sui-guide-dismissed', 'yes');
            localStorage.setItem('sui-lighting-mode', lighting);
          },
          [quality, lighting],
        );
        const page = await context.newPage();
        const errors = [];
        const samples = [];
        // One folder per report: runs with the same engine/entry/condition must not overwrite.
        const shots = resolve(out, '..', 'compile-batches-images', basename(out).replace(/\.json(\.local)?$/, ''));
        mkdirSync(shots, { recursive: true });
        const captureStyle =
          '.app-stage-container, .scene-mode-controls, .app-toolbar { visibility: hidden !important; transition: none !important; }';
        await page.exposeFunction('__suiCapture', async (label) => {
          const image = await page.locator('.sauna-3d-canvas canvas').screenshot({ style: captureStyle });
          const path = join(
            shots,
            `${engine}-${quality}-${lighting}-${entry}-${round}-${condition}${cached ? '-warm' : ''}-hold-${samples.length}.png`,
          );
          writeFileSync(path, image);
          samples.push({ label, image: path, sha256: createHash('sha256').update(image).digest('hex') });
        });
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => {
          if (m.type() === 'error') errors.push(m.text());
        });
        await page.goto(`${url}?view=2d&resolution=fixed&frameRate=full`);
        await page.getByRole('button', { name: '音なしで入室する' }).click();
        if (entry !== 'sauna') {
          await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
          await page.getByRole('button', { name: '外気浴へ', exact: true }).waitFor();
          if (entry === 'totonou') {
            await page.getByRole('button', { name: '外気浴へ', exact: true }).click();
            await page.getByRole('button', { name: 'もう一度サウナへ', exact: true }).waitFor();
          }
        }
        await page.locator('.display-settings > summary').click();
        await page.evaluate(() => {
          window.__suiBatches.startWindow();
          window.__suiBatches.mark('entry-click');
        });
        await page.getByRole('button', { name: '3Dを試す', exact: true }).click();
        // Close settings before the retained-image samples; screenshot styles only hide DOM.
        await page.keyboard.press('Escape');
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
          groups: window.__suiBatches.groups,
          presentationWrites: window.__suiBatches.presentationWrites,
        }));
        row.condition = condition;
        row.batch = batch;
        row.prefetch = prefetch;
        row.fence = fence;
        row.incremental = incremental;
        row.all = all;
        row.visibility = visibility;
        row.budget = budget;
        row.offscreen = offscreen;
        row.multi = multi;
        row.selective = selective;
        row.samples = samples;
        row.entry = entry;
        row.warm = cached;
        row.round = round;
        row.nonce = nonce;
        row.errors = errors;
        row.stages = [];
        const stages = ['sauna', 'water', 'totonou'];
        const buttons = { sauna: 'もう一度サウナへ', water: '水風呂へ', totonou: '外気浴へ' };
        const order = [...stages.slice(stages.indexOf(entry)), ...stages.slice(0, stages.indexOf(entry))];
        for (const [index, stage] of order.entries()) {
          const button = index ? buttons[stage] : null;
          if (button) {
            // Labels new draw states only; the phase events ended with the measurement.
            await page.evaluate((phase) => {
              window.__suiBatches.phase = phase;
            }, `stage-${stage}`);
            await page.getByRole('button', { name: button, exact: true }).click();
            await page.locator(`.sauna-3d-canvas[data-stage="${stage}"]`).waitFor();
          }
          await page.waitForTimeout(2000);
          const image = await page.locator('.sauna-3d-canvas canvas').screenshot({ style: captureStyle });
          const path = join(
            shots,
            `${engine}-${quality}-${lighting}-${entry}-${round}-${condition}${cached ? '-warm' : ''}-${stage}.png`,
          );
          writeFileSync(path, image);
          row.stages.push({ stage, image: path, sha256: createHash('sha256').update(image).digest('hex') });
        }
        row.newKeys = await page.evaluate(() => window.__suiBatches.newKeys);
        rows.push(row);
        console.log(
          JSON.stringify({
            condition,
            entry,
            warm: cached,
            prefetched: row.prefetches.length,
            round,
            loadMs: row.data.loadMs,
            longestGap: Math.max(0, ...row.gaps),
            steps: row.steps.length,
            pipelines: row.pipelines,
            stepSum: Math.round(row.steps.reduce((sum, s) => sum + s.ms, 0)),
            maxStep: Math.round(Math.max(0, ...row.steps.map((s) => s.ms))),
            heavyKeysByPhase: Object.entries(
              row.newKeys
                .filter((k) => k.heavy)
                .reduce((counts, k) => ({ ...counts, [k.phase]: (counts[k.phase] ?? 0) + 1 }), {}),
            ),
            keyMismatches: row.keyMismatches.length,
            errors,
          }),
        );
        if (errors.length || row.keyMismatches.length || row.steps.at(-1)?.pending || (visibility && !row.steps.length))
          throw new Error('incomplete/errored diagnostic');
        await context.close();
      }
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
        schema: 10,
        entry,
        quality,
        lighting,
        hold,
        warm,
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
        temporaryOutput: hash(readFileSync(outputPath)),
        note: 'Fresh zero-valued output uniform per run (with warm, shared by its cold and cached load in one browser); no cache deletion. Standard, 1200x800 DPR1.5, reduced motion; 3D enabled from entry stage after entering in 2D. v-conditions choose material.visible, o additionally draws the HDR target without TAA/presentation; m steps the groups from all three stage views (entry first) and counts a group warmed per pass only once three drew one of its materials there; s re-collects groups per view from visible objects and only needs the passes that can draw them. newKeys includes stage changes. SUI_HOLD adds compositor screenshots and waits: its intervals/load times are not performance comparisons. Instrumented, not product timings.',
        rows,
      },
      null,
      2,
    ) + '\n',
  );
}
