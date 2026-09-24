import * as THREE from 'three';

// Cycles composites glass, water and steam in scene-linear light and only then applies the view
// transform. three tone maps every material on its own, so a transparent surface was blended
// over already tone-mapped pixels (a 0.85 transmittance darkened the view behind it by about
// half as much again). This renders the scene into a multisampled half-float target and tone
// maps it once in a full-screen pass. three 0.186's own outputBufferType does the same, but
// renderer.dispose() does not release its targets.

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
}`;

export interface RenderStats {
  calls: number;
  triangles: number;
}

/**
 * Draws the scene through a linear HDR buffer when the device can render to half floats, else
 * directly (materials tone map themselves, as before). Returns the scene pass's draw counts.
 */
export function createHdrOutput(renderer: THREE.WebGLRenderer) {
  const stats: RenderStats = { calls: 0, triangles: 0 };
  const record = () => {
    stats.calls = renderer.info.render.calls;
    stats.triangles = renderer.info.render.triangles;
    return stats;
  };
  if (!renderer.extensions?.has('EXT_color_buffer_float'))
    return {
      hdr: false,
      render(scene: THREE.Scene, camera: THREE.Camera) {
        renderer.render(scene, camera);
        return record();
      },
      dispose() {},
    };
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
  return {
    hdr: true,
    render(scene: THREE.Scene, camera: THREE.Camera) {
      renderer.getDrawingBufferSize(size);
      if (target.width !== size.x || target.height !== size.y) target.setSize(size.x, size.y);
      // Materials skip tone mapping when drawn into a render target.
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      record();
      renderer.setRenderTarget(null);
      renderer.render(quad, screen);
      return stats;
    },
    dispose() {
      target.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
export type HdrOutput = ReturnType<typeof createHdrOutput>;
