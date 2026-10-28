import * as THREE from 'three';
import { PREPASS_LAYER } from './depthPrepass';
import { createTemporalAA } from './temporalAA';
import { createShimmerUniforms, SHIMMER_GLSL } from './heatShimmer';
import { createHazeUniforms, HAZE_FORWARD, HAZE_GLSL } from './steamHaze';

// Cycles composites glass, water and steam in scene-linear light and only then applies the view
// transform. three tone maps every material on its own, so a transparent surface was blended
// over already tone-mapped pixels (a 0.85 transmittance darkened the view behind it by about
// half as much again). This renders the scene into a multisampled half-float target and tone
// maps it once in a full-screen pass. three 0.186's own outputBufferType does the same, but
// renderer.dispose() does not release its targets.
// Between the two, temporalAA.ts may blend the image with the previous frames.

/**
 * A grade after the view transform in the clear day (not in the source): AgX with look None keeps
 * the source's flat, hazy daylight, so the sunny garden read as overcast grey. An S-curve about
 * mid-grey in display gamma (monotonic for contrast below 0.5) and a little more saturation,
 * by the clear day's weight (lighting.ts clearDay); dusk, night, rain and snow keep the source's.
 */
export const CLEAR_LOOK = { contrast: 0.3, saturation: 0.1 };

// The full-screen triangle; the pass includes three's tone mapping and output color space.
const vertexShader = /* glsl */ `varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;
// The heat haze above the stove moves where the image is read (heatShimmer.ts); the room's steam
// pales it by the length of each view ray in the room, from the scene's depth, part toward its even
// color and part toward the scene blurred around the pixel (the forward scattering, steamHaze.ts).
const fragmentShader = /* glsl */ `uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform mat4 suiProjectionInverse;
uniform mat4 suiCameraWorld;
uniform float suiClearLook;
varying vec2 vUv;
${SHIMMER_GLSL}
${HAZE_GLSL}
void main() {
	vec2 uv = suiShimmer( vUv );
	gl_FragColor = texture2D( tScene, uv );
	if ( suiSteamHaze > 0.0 ) {
		vec4 view = suiProjectionInverse * vec4( uv * 2.0 - 1.0, texture2D( tDepth, uv ).x * 2.0 - 1.0, 1.0 );
		vec3 origin = suiCameraWorld[ 3 ].xyz;
		vec3 world = ( suiCameraWorld * vec4( view.xyz / view.w, 1.0 ) ).xyz;
		vec4 haze = suiHaze( origin, world - origin );
		vec3 forward = suiHazeForward( tScene, uv );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( suiSteamHazeColor + haze.rgb, forward, ${HAZE_FORWARD.share.toFixed(3)} ), haze.a );
	}
	#include <tonemapping_fragment>
	// The clear day's look (CLEAR_LOOK): AgX without a look leaves a sunny garden grey and flat.
	if ( suiClearLook > 0.0 ) {
		vec3 c = pow( max( gl_FragColor.rgb, 0.0 ), vec3( 1.0 / 2.2 ) );
		c += ${CLEAR_LOOK.contrast.toFixed(3)} * suiClearLook * ( c - 0.5 ) * 4.0 * c * ( 1.0 - c );
		float luma = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
		c = luma + ( c - luma ) * ( 1.0 + ${CLEAR_LOOK.saturation.toFixed(3)} * suiClearLook );
		gl_FragColor.rgb = pow( clamp( c, 0.0, 1.0 ), vec3( 2.2 ) );
	}
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
      // Needs the half-float target: drawing into the canvas would show partial images.
      warm(_scene: THREE.Scene, _camera: THREE.Camera): RenderStats {
        throw new Error('Warmup needs the HDR target');
      },
      drain() {},
      setTemporal(_on: boolean) {},
      resetTemporal() {},
      // No full-screen pass to move or haze the image in.
      look: null,
      shimmer: null,
      haze: null,
      compile: compileLinked,
      dispose() {
        released = true;
      },
    };
  // Four samples: two drew about 10% faster but stepped the leaf cards' edges (alpha to coverage,
  // leafCluster.ts) and the deck's lines visibly even at ratio 1.5 (docs/3d-qa/main-msaa/), and
  // at the high quality's ratio 2 kept about 80% of that difference (docs/3d-qa/high-dpr2-msaa/).
  // The depth is resolved into its texture only while the steam hazes the view.
  const depth = new THREE.DepthTexture(1, 1);
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthTexture: depth });
  target.resolveDepthBuffer = false;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const shimmer = createShimmerUniforms();
  const haze = createHazeUniforms();
  const look = { value: 0 };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: target.texture },
      tDepth: { value: depth },
      suiProjectionInverse: { value: new THREE.Matrix4() },
      suiCameraWorld: { value: new THREE.Matrix4() },
      suiClearLook: look,
      ...shimmer,
      ...haze,
    },
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const screen = new THREE.Camera();
  const size = new THREE.Vector2();
  const pixel = new Uint16Array(4);
  const temporal = createTemporalAA(renderer);
  let temporalOn = false;
  return {
    hdr: true,
    render(scene: THREE.Scene, camera: THREE.Camera) {
      renderer.getDrawingBufferSize(size);
      if (target.width !== size.x || target.height !== size.y) target.setSize(size.x, size.y);
      // Materials skip tone mapping when drawn into a render target.
      target.resolveDepthBuffer = haze.suiSteamHaze.value > 0;
      material.uniforms.suiProjectionInverse.value.copy(camera.projectionMatrixInverse);
      material.uniforms.suiCameraWorld.value.copy(camera.matrixWorld);
      renderer.setRenderTarget(target);
      drawScene(scene, camera);
      material.uniforms.tScene.value = temporalOn
        ? temporal.resolve(target.texture, camera as THREE.PerspectiveCamera, size.x, size.y)
        : target.texture;
      renderer.setRenderTarget(null);
      renderer.render(quad, screen);
      return stats;
    },
    /**
     * Draws the scene pass into the HDR target only, as `render` does but without the history or
     * the canvas: the canvas keeps the last full image (sceneWarmup.ts).
     */
    warm(scene: THREE.Scene, camera: THREE.Camera) {
      const previous = renderer.getRenderTarget();
      renderer.getDrawingBufferSize(size);
      if (target.width !== size.x || target.height !== size.y) target.setSize(size.x, size.y);
      try {
        renderer.setRenderTarget(target);
        return drawScene(scene, camera);
      } finally {
        renderer.setRenderTarget(previous);
      }
    },
    /** Waits for the draws so far: a one-pixel read finishes the queue, and with it new pipelines. */
    drain() {
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel);
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
    /** The clear day's look (0–1, CLEAR_LOOK). */
    look,
    /** The heat haze's uniforms (heatShimmer.ts updateShimmer). */
    shimmer,
    /** The room steam's uniforms (steamHaze.ts createSteamHaze, hazeColor). */
    haze,
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
      depth.dispose();
      temporal.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
export type HdrOutput = ReturnType<typeof createHdrOutput>;
