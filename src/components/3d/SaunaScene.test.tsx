import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { AudioEngine } from '../../hooks/useAudioEngine';
import definition from '../../../public/models/sauna.scene.json';
import SaunaScene, { type SceneProps } from './SaunaScene';

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  renderers: [] as any[],
  // The garden request stays pending unless a test answers it.
  garden: vi.fn(() => new Promise<any>(() => {})),
}));
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement('canvas');
      shadowMap = {};
      info = { render: { triangles: 0, calls: 0 }, memory: { textures: 0, geometries: 0 } };
      // No half-float color buffers: materials tone map themselves.
      extensions = { has: () => false };
      setPixelRatio = vi.fn();
      getPixelRatio = () => 1;
      setSize = vi.fn();
      render = vi.fn();
      compileAsync = vi.fn(async () => {});
      // No programs: the compiled ones are ready at once.
      properties = { get: () => ({}) };
      getContext = () => ({ isContextLost: () => false });
      setAnimationLoop = vi.fn();
      dispose = vi.fn();
      forceContextLoss = vi.fn();
      constructor() {
        mocks.renderers.push(this);
      }
    },
  };
});
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    setMeshoptDecoder() {
      return this;
    }
    parseAsync = mocks.parse;
  },
}));

// Smallest valid probe layout: 2×2×2 probes per grid, day, evening and night.
const irradiance = {
  scenes: ['day', 'evening', 'night'],
  grids: ['room', 'courtyard', 'outer', 'water'].map((name, i) => ({
    name,
    min: [0, 0, 0],
    max: [1, 1, 1],
    resolution: [2, 2, 2],
    offset: { day: i * 648, evening: i * 648 + 216, night: i * 648 + 432 },
  })),
};
const irradianceBytes = 4 * 648 * 2;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function model() {
  const scene = new THREE.Group();
  const geometry = new THREE.BoxGeometry();
  const texture = new THREE.Texture();
  const material = new THREE.MeshBasicMaterial({ map: texture });
  scene.add(new THREE.Mesh(geometry, material));
  return { scene, disposals: [geometry, texture, material].map((resource) => vi.spyOn(resource, 'dispose')) };
}
function mountScene(props: Partial<Pick<SceneProps, 'lightingMode' | 'enteredAt' | 'quality'>> = {}) {
  const audio = { setSpatialPose: vi.fn() } as unknown as AudioEngine;
  const onReady = vi.fn();
  const onError = vi.fn();
  const onGardenLoading = vi.fn();
  const loylyEvents = new EventTarget();
  const element = (changes: typeof props) => (
    <SaunaScene
      audio={audio}
      quality="standard"
      stage="sauna"
      lightingMode="day"
      {...props}
      {...changes}
      loylyEvents={loylyEvents}
      onReady={onReady}
      onError={onError}
      onGardenLoading={onGardenLoading}
    />
  );
  const view = render(element({}));
  // Same callbacks and events, so the scene is kept.
  const update = (changes: typeof props) => view.rerender(element(changes));
  return { ...view, update, audio, onReady, onError, onGardenLoading };
}
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.renderers.length = 0;
  mocks.parse.mockReset();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  // A 2D context for the steam's sprite; no WebGL2 of its own (the mocked renderer is made instead).
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) =>
    type === 'webgl2'
      ? null
      : {
          createRadialGradient: () => ({ addColorStop() {} }),
          fillRect() {},
        }) as any);
  mocks.garden.mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('sauna-garden.glb')
        ? mocks.garden()
        : {
            ok: true,
            json: async () => (/(irradiance|reflection)\.json$/.test(url) ? irradiance : definition),
            arrayBuffer: async () => new ArrayBuffer(/(irradiance|reflection)\.bin$/.test(url) ? irradianceBytes : 0),
            url,
          },
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('3D scene load and teardown', () => {
  it.each(['pointerup', 'pointercancel', 'lostpointercapture'])(
    'keeps dragging when a second pointer emits %s',
    async (ending) => {
      mocks.parse.mockResolvedValue(model());
      const view = mountScene();
      await flush();
      const element = view.container.querySelector('.sauna-3d-canvas') as HTMLElement;
      element.setPointerCapture = vi.fn();
      const camera = mocks.renderers[0].render.mock.calls[0][1] as THREE.PerspectiveCamera;
      const send = (type: string, id: number, x: number) => {
        const event = new Event(type);
        Object.assign(event, { pointerId: id, isPrimary: id === 1, button: 0, clientX: x, clientY: 200 });
        element.dispatchEvent(event);
      };
      send('pointerdown', 1, 100);
      send('pointerdown', 2, 200);
      const initial = camera.rotation.y;
      send('pointermove', 2, 250);
      expect(camera.rotation.y).toBe(initial);
      send(ending, 2, 250);
      send('pointermove', 1, 150);
      expect(camera.rotation.y).toBeCloseTo(initial - 0.2);
      send(ending, 1, 150);
      send('pointermove', 1, 200);
      expect(camera.rotation.y).toBeCloseTo(initial - 0.2);
    },
  );

  it('aborts pending downloads on exit and does not parse their late result', async () => {
    const response = deferred<any>();
    vi.mocked(fetch).mockReturnValue(response.promise);
    const view = mountScene();
    const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
    view.unmount();
    expect(signal.aborted).toBe(true);
    response.resolve({ ok: true, json: async () => definition, arrayBuffer: async () => new ArrayBuffer(0) });
    await flush();
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(view.onReady).not.toHaveBeenCalled();
    expect(view.onError).not.toHaveBeenCalled();
    expect(mocks.renderers[0].dispose).toHaveBeenCalledOnce();
  });

  it.each(['timeout', 'context loss', 'unmount'])(
    'disposes a model resolved after %s without restarting rendering',
    async (reason) => {
      const pending = deferred<any>();
      mocks.parse.mockReturnValue(pending.promise);
      const loaded = model();
      const view = mountScene();
      await flush();
      expect(mocks.parse).toHaveBeenCalledOnce();
      const renderer = mocks.renderers[0];
      if (reason === 'timeout') act(() => vi.advanceTimersByTime(30000));
      else if (reason === 'context loss')
        act(() => {
          renderer.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
        });
      else view.unmount();
      pending.resolve(loaded);
      await flush();
      expect(view.onReady).not.toHaveBeenCalled();
      expect(view.onError).toHaveBeenCalledTimes(reason === 'unmount' ? 0 : 1);
      expect(renderer.render).not.toHaveBeenCalled();
      for (const dispose of loaded.disposals) expect(dispose).toHaveBeenCalledOnce();
      expect(renderer.setAnimationLoop.mock.calls.every(([callback]: any[]) => callback === null)).toBe(true);
    },
  );

  it('draws the scene once its programs compile, compiling again for a quality chosen meanwhile', async () => {
    mocks.parse.mockResolvedValueOnce(model());
    const view = mountScene();
    const renderer = mocks.renderers[0];
    const first = deferred<void>();
    const second = deferred<void>();
    renderer.compileAsync.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await flush();
    expect(renderer.compileAsync).toHaveBeenCalledOnce();
    const [object, , lit] = renderer.compileAsync.mock.calls[0];
    expect(object).toBe(lit);
    expect(renderer.render).not.toHaveBeenCalled();
    view.update({ quality: 'low' });
    expect((view.container.querySelector('.sauna-3d-canvas') as HTMLElement).dataset.quality).toBe('low');
    first.resolve();
    await flush();
    expect(renderer.compileAsync).toHaveBeenCalledTimes(2);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(view.onReady).not.toHaveBeenCalled();
    second.resolve();
    await flush();
    expect(view.onReady).toHaveBeenCalledOnce();
    expect(renderer.render).toHaveBeenCalled();
  });

  it('does not draw a scene left at exit while its programs compile', async () => {
    const loaded = model();
    mocks.parse.mockResolvedValueOnce(loaded);
    const view = mountScene();
    const renderer = mocks.renderers[0];
    const compiled = deferred<void>();
    renderer.compileAsync.mockReturnValueOnce(compiled.promise);
    await flush();
    expect(renderer.compileAsync).toHaveBeenCalledOnce();
    view.unmount();
    compiled.resolve();
    await flush();
    expect(renderer.render).not.toHaveBeenCalled();
    expect(view.onReady).not.toHaveBeenCalled();
    expect(renderer.setAnimationLoop.mock.calls.every(([callback]: any[]) => callback === null)).toBe(true);
    for (const dispose of loaded.disposals) expect(dispose).toHaveBeenCalledOnce();
  });

  it('stops a running scene on context loss, reports once, and releases it on exit', async () => {
    const loaded = model();
    mocks.parse.mockResolvedValue(loaded);
    const view = mountScene();
    await flush();
    expect(view.onReady).toHaveBeenCalledOnce();
    const renderer = mocks.renderers[0];
    expect(renderer.setAnimationLoop).toHaveBeenCalledWith(expect.any(Function));
    act(() => {
      renderer.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      renderer.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      vi.advanceTimersByTime(30000);
    });
    expect(view.onError).toHaveBeenCalledOnce();
    expect(renderer.setAnimationLoop).toHaveBeenLastCalledWith(null);
    expect(view.audio.setSpatialPose).toHaveBeenLastCalledWith(null);
    view.unmount();
    for (const dispose of loaded.disposals) expect(dispose).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(renderer.forceContextLoss).toHaveBeenCalledOnce();
    expect(renderer.domElement.isConnected).toBe(false);
  });

  it('shares one woodland leaf mask between cluster materials and releases it on exit', async () => {
    const loaded = model();
    const cards = ['V6 woodland leaf 0', 'V6 woodland leaf 1'].map((name) =>
      Object.assign(new THREE.MeshStandardMaterial(), { name, userData: { suiLeafCluster: { leaves: 20 } } }),
    );
    loaded.scene.add(
      new THREE.Mesh(new THREE.PlaneGeometry(), cards[0]),
      new THREE.Mesh(new THREE.PlaneGeometry(), cards[1]),
    );
    mocks.parse.mockResolvedValue(loaded);
    const view = mountScene();
    await flush();
    const element = view.container.querySelector('.sauna-3d-canvas') as HTMLElement;
    expect(element.dataset.leafClusterMaterials).toBe('2');
    const mask = cards[0].alphaMap!;
    expect(cards[1].alphaMap).toBe(mask);
    expect(cards.every((card) => card.alphaToCoverage && card.side === THREE.DoubleSide)).toBe(true);
    const release = vi.spyOn(mask, 'dispose');
    view.unmount();
    expect(release).toHaveBeenCalledOnce();
  });

  it('replaces the glass, reflects on the lit materials and releases the probe textures on exit', async () => {
    const loaded = model();
    const pane = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({ name: 'Low iron architectural glass', transparent: true }),
    );
    loaded.scene.add(pane, new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    mocks.parse.mockResolvedValue(loaded);
    const view = mountScene();
    await flush();
    const element = view.container.querySelector('.sauna-3d-canvas') as HTMLElement;
    expect(element.dataset.glassMeshes).toBe('1');
    // The glass is no longer a lit material; the other standard material gets both probe sets.
    expect(element.dataset.irradianceMaterials).toBe('1');
    expect(element.dataset.reflectionMaterials).toBe('1');
    expect(pane.material).toBeInstanceOf(THREE.ShaderMaterial);
    const release = vi.spyOn(THREE.Data3DTexture.prototype, 'dispose');
    view.unmount();
    // One texture per grid holds both the irradiance and the reflection.
    expect(release).toHaveBeenCalledTimes(4);
    release.mockRestore();
  });

  it('aborts the other request when one asset fails', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    const view = mountScene();
    await flush();
    expect(view.onError).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0][1]!.signal!.aborted).toBe(true);
    expect(mocks.parse).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(30000));
    expect(view.onError).toHaveBeenCalledOnce();
  });
});

describe('garden loaded after the ready scene', () => {
  const standard = () => {
    const loaded = model();
    loaded.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    return loaded;
  };
  const ok = { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
  const canvas = (view: ReturnType<typeof mountScene>) =>
    view.container.querySelector('.sauna-3d-canvas') as HTMLElement;

  it('requests the garden only once the scene is ready, then adds it and sums the counts', async () => {
    const response = deferred<any>();
    mocks.garden.mockReturnValue(response.promise);
    const core = standard();
    const garden = standard();
    mocks.parse.mockResolvedValueOnce(core).mockResolvedValueOnce(garden);
    const view = mountScene();
    const requested = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url).split('/').pop());
    expect(requested()).not.toContain('sauna-garden.glb');
    await flush();
    expect(view.onReady).toHaveBeenCalledOnce();
    expect(requested()[requested().length - 1]).toBe('sauna-garden.glb');
    const element = canvas(view);
    expect(element.dataset.garden).toBe('loading');
    expect(view.onGardenLoading).toHaveBeenLastCalledWith(true);
    expect(element.dataset.irradianceMaterials).toBe('1');
    response.resolve(ok);
    await flush();
    const renderer = mocks.renderers[0];
    expect(renderer.compileAsync).toHaveBeenCalledWith(garden.scene, expect.any(THREE.Camera), expect.any(THREE.Scene));
    const scene = renderer.compileAsync.mock.calls[0][2] as THREE.Scene;
    expect(garden.scene.parent).toBe(scene);
    expect(core.scene.parent).toBe(scene);
    expect(element.dataset.garden).toBe('ready');
    expect(view.onGardenLoading).toHaveBeenLastCalledWith(false);
    expect(element.dataset.gardenMs).toMatch(/^\d+$/);
    expect(element.dataset.irradianceMaterials).toBe('2');
    view.unmount();
    for (const dispose of garden.disposals) expect(dispose).toHaveBeenCalledOnce();
  });

  it.each([
    ['a failed request', () => mocks.garden.mockResolvedValue({ ok: false })],
    ['a parse error', () => mocks.parse.mockRejectedValueOnce(Error('bad garden'))],
  ])('keeps the ready scene after %s', async (_, arrange) => {
    mocks.garden.mockResolvedValue(ok);
    mocks.parse.mockResolvedValueOnce(model());
    arrange();
    const view = mountScene();
    await flush();
    await flush();
    const renderer = mocks.renderers[0];
    expect(canvas(view).dataset.garden).toBe('failed');
    expect(view.onGardenLoading).toHaveBeenLastCalledWith(false);
    expect(view.onError).not.toHaveBeenCalled();
    expect(renderer.setAnimationLoop).toHaveBeenLastCalledWith(expect.any(Function));
    act(() => vi.advanceTimersByTime(30000));
    expect(view.onError).not.toHaveBeenCalled();
  });

  it.each(['download', 'compile'])('releases a garden left unfinished at exit during its %s', async (phase) => {
    const response = deferred<any>();
    const compiled = deferred<void>();
    mocks.garden.mockReturnValue(response.promise);
    const garden = model();
    mocks.parse.mockResolvedValueOnce(model()).mockResolvedValueOnce(garden);
    const view = mountScene();
    await flush();
    const renderer = mocks.renderers[0];
    renderer.compileAsync.mockClear();
    renderer.compileAsync.mockReturnValue(compiled.promise);
    const calls = vi.mocked(fetch).mock.calls;
    const signal = calls[calls.length - 1][1]!.signal!;
    if (phase === 'compile') {
      response.resolve(ok);
      await flush();
      expect(renderer.compileAsync).toHaveBeenCalledOnce();
    }
    view.unmount();
    expect(signal.aborted).toBe(true);
    response.resolve(ok);
    compiled.resolve();
    await flush();
    expect(garden.scene.parent).toBeNull();
    expect(mocks.parse).toHaveBeenCalledTimes(phase === 'compile' ? 2 : 1);
    for (const dispose of garden.disposals) expect(dispose).toHaveBeenCalledTimes(phase === 'compile' ? 1 : 0);
  });
  it("keeps drawing the old quality until the chosen one's programs compile, and applies the latest", async () => {
    mocks.parse.mockResolvedValueOnce(model());
    const view = mountScene();
    await flush();
    expect(view.onReady).toHaveBeenCalledOnce();
    const renderer = mocks.renderers[0];
    renderer.compileAsync.mockClear();
    const element = canvas(view);
    const first = deferred<void>();
    const second = deferred<void>();
    renderer.compileAsync.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    view.update({ quality: 'low' });
    view.update({ quality: 'high' });
    expect(renderer.compileAsync).toHaveBeenCalledTimes(2);
    expect(element.dataset.quality).toBe('standard');
    first.resolve();
    await flush();
    expect(element.dataset.quality).toBe('standard');
    second.resolve();
    await flush();
    expect(element.dataset.quality).toBe('high');
  });

  it('does not apply a quality whose programs finish compiling after exit', async () => {
    mocks.parse.mockResolvedValueOnce(model());
    const view = mountScene();
    await flush();
    const renderer = mocks.renderers[0];
    const compiled = deferred<void>();
    renderer.compileAsync.mockReturnValueOnce(compiled.promise);
    view.update({ quality: 'low' });
    const calls = renderer.setPixelRatio.mock.calls.length;
    view.unmount();
    compiled.resolve();
    await flush();
    expect(renderer.setPixelRatio).toHaveBeenCalledTimes(calls);
  });
});

describe('automatic lighting', () => {
  it('follows the real time since entering and stays at night', async () => {
    const entered = 1_000_000;
    vi.setSystemTime(entered + 28.5 * 60_000);
    mocks.parse.mockResolvedValue(model());
    const view = mountScene({ lightingMode: 'auto', enteredAt: entered });
    await flush();
    const element = view.container.querySelector('.sauna-3d-canvas') as HTMLElement;
    const loop = mocks.renderers[0].setAnimationLoop.mock.calls.at(-1)[0] as (now: number) => void;
    // 28.5 minutes in: halfway from dusk into the night, applied when the scene opens.
    loop(1000);
    expect(element.dataset.timeOfDay).toBe('1.500');
    // An hour in, the night stays; the change eases in over the following frames.
    vi.setSystemTime(entered + 60 * 60_000);
    for (let frame = 1; frame <= 200; frame++) loop(1000 + frame * 100);
    expect(element.dataset.timeOfDay).toBe('2.000');
  });
});
