import * as THREE from 'three';
import { PREPASS_LAYER } from './depthPrepass';
import { createTemporalAA } from './temporalAA';

// Cycles composites glass, water and steam in scene-linear light and only then applies the view
// transform. three tone maps every material on its own, so a transparent surface was blended
// over already tone-mapped pixels (a 0.85 transmittance darkened the view behind it by about
// half as much again). This renders the scene into a multisampled half-float target and tone
// maps it once in a full-screen pass. three 0.186's own outputBufferType does the same, but
// renderer.dispose() does not release its targets.
// Between the two, temporalAA.ts may blend the image with the previous frames.

// The full-screen triangle; the pass includes three's tone mapping and output color space.
const vertexShader = /* glsl */ `varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;
const fragmentShader = /* glsl */ `uniform sampler2D tScene;
varying vec2 vUv;
void main() {
	gl_FragColor = texture2D( tScene, vUv );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	// The canvas has alpha: the scene's alpha (under 1 at some leaf edges) let the page show through.
	gl_FragColor.a = 1.0;
}`;

/**
 * With half-float color buffers the scene is drawn multisampled into its own target and the canvas
 * only gets the full-screen pass, so the canvas needs neither multisampling nor depth (with them,
 * about 36 bytes a pixel instead of 4). Without, the scene is drawn into the canvas as before.
 */
export function createRenderer() {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false });
  if (context?.getExtension('EXT_color_buffer_float'))
    return new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: false, depth: false });
  context?.getExtension('WEBGL_lose_context')?.loseContext();
  return new THREE.WebGLRenderer({ antialias: true, alpha: true });
}

export interface RenderStats {
  calls: number;
  triangles: number;
}

/**
 * Draws the scene through a linear HDR buffer when the device can render to half floats, else
 * directly (materials tone map themselves, as before). Returns the lit scene pass's draw counts.
 */
export function createHdrOutput(renderer: THREE.WebGLRenderer) {
  const stats: RenderStats = { calls: 0, triangles: 0 };
  let released = false;
  // three's compileAsync waits on each material's current program, which a draw of the scene in
  // the meantime sets back to the one for the lights drawn (a quality change compiles for others),
  // so this also waits on the programs it compiled. Unlit materials don't compare the shadows when
  // drawn and would keep the compiled program (its first use waits for the driver): each is marked
  // to choose its program again.
  // `within` ms at most: the programs not linked by then wait for the driver when first drawn.
  const compileLinked = (object: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene, within = Infinity) => {
    const compiled = renderer.compileAsync(object, camera, scene);
    const programs: { isReady(): boolean }[] = [];
    object.traverse((child) => {
      const material = (child as THREE.Mesh).material;
      for (const each of Array.isArray(material) ? material : material ? [material] : []) {
        const program = (renderer.properties.get(each) as { currentProgram?: { isReady(): boolean } }).currentProgram;
        if (program) programs.push(program);
        each.needsUpdate = true;
      }
    });
    const linked = new Promise<void>((resolve) => {
      const check = () => {
        if (released || renderer.getContext().isContextLost() || programs.every((program) => program.isReady()))
          resolve();
        else setTimeout(check, 10);
      };
      check();
    });
    const done = Promise.all([compiled, linked]).then(() => {});
    if (!Number.isFinite(within)) return done;
    return Promise.race([done, new Promise<void>((resolve) => setTimeout(resolve, within))]);
  };
  const record = () => {
    stats.calls = renderer.info.render.calls;
    stats.triangles = renderer.info.render.triangles;
    return stats;
  };
  // The depth-only copies first (depthPrepass.ts), then the lit pass over their depth.
  const drawScene = (scene: THREE.Scene, camera: THREE.Camera) => {
    const mask = camera.layers.mask;
    camera.layers.set(PREPASS_LAYER);
    renderer.render(scene, camera);
    camera.layers.mask = mask;
    renderer.autoClearDepth = false;
    renderer.render(scene, camera);
    renderer.autoClearDepth = true;
    return record();
  };
  if (!renderer.extensions?.has('EXT_color_buffer_float'))
    return {
      hdr: false,
      render(scene: THREE.Scene, camera: THREE.Camera) {
        return drawScene(scene, camera);
      },
      // Needs the half-float target.
      setTemporal(_on: boolean) {},
      resetTemporal() {},
      compile: compileLinked,
      dispose() {
        released = true;
      },
    };
  // Four samples: two drew about 10% faster but stepped the leaf cards' edges (alpha to coverage,
  // leafCluster.ts) and the deck's lines visibly even at ratio 1.5 (docs/3d-qa/main-msaa/), and
  // at the high quality's ratio 2 kept about 80% of that difference (docs/3d-qa/high-dpr2-msaa/).
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const material = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: target.texture } },
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const screen = new THREE.Camera();
  const size = new THREE.Vector2();
  const temporal = createTemporalAA(renderer);
  let temporalOn = false;
  return {
    hdr: true,
    render(scene: THREE.Scene, camera: THREE.Camera) {
      renderer.getDrawingBufferSize(size);
      if (target.width !== size.x || target.height !== size.y) target.setSize(size.x, size.y);
      // Materials skip tone mapping when drawn into a render target.
      renderer.setRenderTarget(target);
      drawScene(scene, camera);
      material.uniforms.tScene.value = temporalOn
        ? temporal.resolve(target.texture, camera as THREE.PerspectiveCamera, size.x, size.y)
        : target.texture;
      renderer.setRenderTarget(null);
      renderer.render(quad, screen);
      return stats;
    },
    /** Blends with the previous frames (temporalAA.ts) or not; off releases the histories. */
    setTemporal(on: boolean) {
      if (temporalOn && !on) temporal.release();
      temporalOn = on;
    },
    /** Starts the blend over (the image changed other than by turning). */
    resetTemporal() {
      temporal.reset();
    },
    /** Compiles `object` as lit by `scene` for the HDR pass (the programs differ from the canvas's). */
    compile(object: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene, within = Infinity) {
      // The programs are created synchronously; only the wait for the driver is asynchronous.
      renderer.setRenderTarget(target);
      const compiled = compileLinked(object, camera, scene, within);
      renderer.setRenderTarget(null);
      return compiled;
    },
    dispose() {
      released = true;
      target.dispose();
      temporal.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
export type HdrOutput = ReturnType<typeof createHdrOutput>;
