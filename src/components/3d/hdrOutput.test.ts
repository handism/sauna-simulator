import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createHdrOutput, createRenderer } from './hdrOutput';
import { PREPASS_LAYER } from './depthPrepass';

// The parameters of each renderer made (createRenderer).
const made = vi.hoisted(() => [] as THREE.WebGLRendererParameters[]);
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    WebGLRenderer: class {
      constructor(parameters: THREE.WebGLRendererParameters) {
        made.push(parameters);
      }
    },
  };
});

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

  it.each([
    ['waits for its programs to link', Infinity, 50],
    ['waits at most the given time', 30, 30],
  ])('compiles a scene and %s', async (_, within, settled) => {
    vi.useFakeTimers();
    try {
      const { renderer } = fakeRenderer(true);
      let ready = false;
      const program = { isReady: () => ready };
      Object.assign(renderer, {
        compileAsync: vi.fn(async () => {}),
        properties: { get: () => ({ currentProgram: program }) },
        getContext: () => ({ isContextLost: () => false }),
      });
      const output = createHdrOutput(renderer);
      const scene = new THREE.Scene();
      const material = new THREE.MeshBasicMaterial();
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
      const version = material.version;
      let done = false;
      void output.compile(scene, new THREE.PerspectiveCamera(), scene, within).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(25);
      expect(done).toBe(false);
      // Chooses its program again when drawn next.
      expect(material.version).toBe(version + 1);
      setTimeout(() => (ready = true), 50 - 25);
      await vi.advanceTimersByTimeAsync(settled - 25 + 10);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not wait without parallel shader compile', async () => {
    vi.useFakeTimers();
    try {
      const { renderer } = fakeRenderer(true);
      // three flags each program ready at once without KHR_parallel_shader_compile (its first use waits).
      Object.assign(renderer, {
        compileAsync: vi.fn(async () => {}),
        properties: { get: () => ({ currentProgram: { isReady: () => true } }) },
        getContext: () => ({ isContextLost: () => false }),
      });
      const output = createHdrOutput(renderer);
      const scene = new THREE.Scene();
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
      let done = false;
      void output.compile(scene, new THREE.PerspectiveCamera(), scene, 1000).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the canvas', () => {
  const contexts = (halfFloat: boolean) => {
    const lose = vi.fn();
    const context = {
      getExtension: (name: string) =>
        name === 'WEBGL_lose_context'
          ? { loseContext: lose }
          : halfFloat && name === 'EXT_color_buffer_float'
            ? {}
            : null,
    };
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as any);
    return { context, lose, getContext };
  };

  it('has no multisampling or depth when the scene is drawn into a half-float target', () => {
    made.length = 0;
    const { context, lose, getContext } = contexts(true);
    createRenderer();
    expect(getContext).toHaveBeenCalledWith('webgl2', { alpha: true, antialias: false, depth: false });
    expect(made).toEqual([expect.objectContaining({ context, alpha: true, antialias: false, depth: false })]);
    expect(lose).not.toHaveBeenCalled();
    getContext.mockRestore();
  });

  it('keeps a multisampled canvas when the scene is drawn into it', () => {
    made.length = 0;
    const { lose, getContext } = contexts(false);
    createRenderer();
    // The probing context is released for three's own.
    expect(lose).toHaveBeenCalledOnce();
    expect(made).toEqual([{ antialias: true, alpha: true }]);
    getContext.mockRestore();
  });
});
