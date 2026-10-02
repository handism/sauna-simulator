import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createHdrOutput } from './hdrOutput';
import { PREPASS_LAYER } from './depthPrepass';

function fakeRenderer(halfFloat: boolean) {
  const targets: (THREE.WebGLRenderTarget | null)[] = [];
  // Per render(): the camera's layers and whether it cleared the depth.
  const passes: { layers: number; clearDepth: boolean }[] = [];
  let target: THREE.WebGLRenderTarget | null = null;
  const renderer = {
    extensions: { has: (name: string) => halfFloat && name === 'EXT_color_buffer_float' },
    info: { render: { calls: 0, triangles: 0 } },
    autoClearDepth: true,
    getDrawingBufferSize: (size: THREE.Vector2) => size.set(640, 400),
    setRenderTarget: (next: THREE.WebGLRenderTarget | null) => (target = next),
    render: vi.fn((object: THREE.Object3D, camera: THREE.Camera) => {
      targets.push(target);
      passes.push({ layers: camera.layers.mask, clearDepth: renderer.autoClearDepth });
      // Each render() resets the counts, as three's info.autoReset does.
      const prepass = camera.layers.isEnabled(PREPASS_LAYER);
      renderer.info.render = !(object instanceof THREE.Scene)
        ? { calls: 1, triangles: 1 }
        : prepass
          ? { calls: 7, triangles: 1000 }
          : { calls: 12, triangles: 3456 };
    }),
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, targets, passes, calls: renderer.render };
}

// The depth-only pass first, then the lit pass on the camera's own layers keeping that depth.
function expectPrepass(passes: { layers: number; clearDepth: boolean }[], camera: THREE.Camera) {
  const prepass = new THREE.Layers();
  prepass.set(PREPASS_LAYER);
  expect(passes.slice(0, 2)).toEqual([
    { layers: prepass.mask, clearDepth: true },
    { layers: camera.layers.mask, clearDepth: false },
  ]);
}

describe('HDR output', () => {
  it('renders the scene into a half-float target and tone maps it once', () => {
    const { renderer, targets, passes, calls } = fakeRenderer(true);
    const output = createHdrOutput(renderer);
    expect(output.hdr).toBe(true);
    const camera = new THREE.PerspectiveCamera();
    camera.layers.enable(2);
    const stats = output.render(new THREE.Scene(), camera);
    // The lit scene pass's counts, not the depth-only or full-screen pass's.
    expect(stats).toEqual({ calls: 12, triangles: 3456 });
    expectPrepass(passes, camera);
    expect(renderer.autoClearDepth).toBe(true);
    const [depth, scene, screen] = targets;
    expect(depth).toBe(scene);
    expect(scene?.texture.type).toBe(THREE.HalfFloatType);
    expect([scene?.width, scene?.height, scene?.samples]).toEqual([640, 400, 4]);
    expect(screen).toBeNull();
    const quad = calls.mock.calls[2][0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    expect(quad.material.toneMapped).toBe(true);
    expect(quad.material.fragmentShader).toContain('#include <tonemapping_fragment>');
    expect(quad.material.uniforms.tScene.value).toBe(scene?.texture);
    // The canvas has alpha; the scene's own must not let the page show through.
    expect(quad.material.fragmentShader).toContain('gl_FragColor.a = 1.0;');
    let released = false;
    scene?.addEventListener('dispose', () => (released = true));
    output.dispose();
    expect(released).toBe(true);
  });

  it('tone maps the blend with the previous frames while it is on', () => {
    const { renderer, targets, calls } = fakeRenderer(true);
    const output = createHdrOutput(renderer);
    const camera = new THREE.PerspectiveCamera();
    output.setTemporal(true);
    output.render(new THREE.Scene(), camera);
    // Depth, lit, the blend into a history, then tone mapping of that history.
    const [, scene, history, screen] = targets;
    expect(history).not.toBe(scene);
    expect(history?.samples).toBe(0);
    expect(screen).toBeNull();
    const quad = calls.mock.calls[3][0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    expect(quad.material.uniforms.tScene.value).toBe(history?.texture);
    let released = false;
    history?.addEventListener('dispose', () => (released = true));
    output.setTemporal(false);
    expect(released).toBe(true);
    output.render(new THREE.Scene(), camera);
    expect(targets.slice(4)).toEqual([scene, scene, null]);
    expect(quad.material.uniforms.tScene.value).toBe(scene?.texture);
  });

  it('falls back to per-material tone mapping without half-float color buffers', () => {
    const { renderer, targets, passes } = fakeRenderer(false);
    const output = createHdrOutput(renderer);
    expect(output.hdr).toBe(false);
    const camera = new THREE.PerspectiveCamera();
    expect(output.render(new THREE.Scene(), camera)).toEqual({ calls: 12, triangles: 3456 });
    expectPrepass(passes, camera);
    expect(targets).toEqual([null, null]);
  });
});
