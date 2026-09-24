import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { AudioEngine } from '../../hooks/useAudioEngine';
import definition from '../../../public/models/sauna.scene.json';
import SaunaScene from './SaunaScene';

const mocks = vi.hoisted(() => ({ parse: vi.fn(), renderers: [] as any[] }));
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement('canvas');
      shadowMap = {};
      info = { render: { triangles: 0, calls: 0 }, memory: { textures: 0, geometries: 0 } };
      setPixelRatio = vi.fn();
      getPixelRatio = () => 1;
      setSize = vi.fn();
      render = vi.fn();
      setAnimationLoop = vi.fn();
      dispose = vi.fn();
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

// Smallest valid probe layout: 2×2×2 probes per grid, day and evening.
const irradiance = {
  scenes: ['day', 'evening'],
  grids: ['room', 'courtyard', 'outer'].map((name, i) => ({
    name,
    min: [0, 0, 0],
    max: [1, 1, 1],
    resolution: [2, 2, 2],
    offset: { day: i * 432, evening: i * 432 + 216 },
  })),
};
const irradianceBytes = 3 * 432 * 2;

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
function mountScene() {
  const audio = { setSpatialPose: vi.fn() } as unknown as AudioEngine;
  const onReady = vi.fn();
  const onError = vi.fn();
  const view = render(
    <SaunaScene
      audio={audio}
      quality="standard"
      stage="sauna"
      lightingMode="day"
      loylyEvents={new EventTarget()}
      onReady={onReady}
      onError={onError}
    />,
  );
  return { ...view, audio, onReady, onError };
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
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    createRadialGradient: () => ({ addColorStop() {} }),
    fillRect() {},
  } as any);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.endsWith('irradiance.json') ? irradiance : definition),
      arrayBuffer: async () => new ArrayBuffer(url.endsWith('irradiance.bin') ? irradianceBytes : 0),
      url,
    })),
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
