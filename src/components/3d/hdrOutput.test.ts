import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createHdrOutput } from './hdrOutput';

function fakeRenderer(halfFloat: boolean) {
  const targets: (THREE.WebGLRenderTarget | null)[] = [];
  let target: THREE.WebGLRenderTarget | null = null;
  const renderer = {
    extensions: { has: (name: string) => halfFloat && name === 'EXT_color_buffer_float' },
    info: { render: { calls: 0, triangles: 0 } },
    getDrawingBufferSize: (size: THREE.Vector2) => size.set(640, 400),
    setRenderTarget: (next: THREE.WebGLRenderTarget | null) => (target = next),
    render: vi.fn((object: THREE.Object3D) => {
      targets.push(target);
      // Each render() resets the counts, as three's info.autoReset does.
      renderer.info.render =
        object instanceof THREE.Scene ? { calls: 12, triangles: 3456 } : { calls: 1, triangles: 1 };
    }),
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, targets, calls: renderer.render };
}

describe('HDR output', () => {
  it('renders the scene into a half-float target and tone maps it once', () => {
    const { renderer, targets, calls } = fakeRenderer(true);
    const output = createHdrOutput(renderer);
    expect(output.hdr).toBe(true);
    const stats = output.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    // The scene pass's counts, not the full-screen pass's.
    expect(stats).toEqual({ calls: 12, triangles: 3456 });
    const [scene, screen] = targets;
    expect(scene?.texture.type).toBe(THREE.HalfFloatType);
    expect([scene?.width, scene?.height, scene?.samples]).toEqual([640, 400, 4]);
    expect(screen).toBeNull();
    const quad = calls.mock.calls[1][0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    expect(quad.material.toneMapped).toBe(true);
    expect(quad.material.fragmentShader).toContain('#include <tonemapping_fragment>');
    expect(quad.material.uniforms.tScene.value).toBe(scene?.texture);
    let released = false;
    scene?.addEventListener('dispose', () => (released = true));
    output.dispose();
    expect(released).toBe(true);
  });

  it('falls back to per-material tone mapping without half-float color buffers', () => {
    const { renderer, targets } = fakeRenderer(false);
    const output = createHdrOutput(renderer);
    expect(output.hdr).toBe(false);
    expect(output.render(new THREE.Scene(), new THREE.PerspectiveCamera())).toEqual({ calls: 12, triangles: 3456 });
    expect(targets).toEqual([null]);
  });
});
