import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { startSceneWarmup, type SceneWarmupTarget } from './sceneWarmup';
import type { WarmupPass } from './warmupPasses';

type View = 'sauna' | 'water';

function fixture() {
  const root = new THREE.Group();
  const programs = new Map<THREE.Material, object>();
  const shader = {} as WebGLShader;
  const renderer = {
    properties: { get: (material: THREE.Material) => ({ currentProgram: programs.get(material) }) },
    getContext: () => ({ getShaderSource: () => 'x'.repeat(40000) }),
  } as unknown as THREE.WebGLRenderer;
  const add = (name: string, y = 1) => {
    const material = new THREE.MeshBasicMaterial({ name });
    programs.set(material, { id: programs.size, vertexShader: shader, fragmentShader: shader });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), material);
    mesh.name = name;
    mesh.position.y = y;
    root.add(mesh);
    return mesh;
  };
  // What each view's camera sees; everything is above the water, so the mirror may draw it.
  const seen: Record<View, string[]> = { sauna: [], water: [] };
  const mirrorInSight: Record<View, boolean> = { sauna: true, water: true };
  let current: View = 'sauna';
  const log: string[] = [];
  const draw = vi.fn((pass: WarmupPass) => {
    if (pass === 'mirror' && !mirrorInSight[current]) return false;
    const drawn: string[] = [];
    root.traverseVisible((object) => {
      const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      if (!mesh.material?.visible || !seen[current].includes(mesh.name)) return;
      mesh.onBeforeRender(renderer, new THREE.Scene(), new THREE.Camera(), mesh.geometry, mesh.material, null as never);
      drawn.push(mesh.name);
    });
    log.push(`${current}:${pass}:${drawn.join('+')}`);
    return true;
  });
  const target: SceneWarmupTarget<View> = {
    renderer,
    root,
    views: ['sauna', 'water'],
    pose: vi.fn((view: View) => {
      current = view;
      root.updateMatrixWorld(true);
    }),
    passOptions: () => ({
      mainLayers: new THREE.Layers(),
      mirrorEnabled: true,
      shadowMaskEnabled: false,
      waterLevel: 0,
    }),
    draw,
  };
  const schedule = () => ({
    signal: new AbortController().signal,
    deadline: performance.now() + 1e6,
    isCurrent: () => true,
  });
  return { root, add, seen, mirrorInSight, log, draw, target, schedule, programs };
}

describe('scene warmup', () => {
  it('draws the rest, then one group at a time per pass, carrying prepared groups to later views', async () => {
    const { add, seen, log, target, schedule } = fixture();
    const wall = add('wall');
    const own = vi.fn();
    wall.onBeforeRender = own;
    add('bench');
    add('rail');
    seen.sauna = ['wall', 'bench'];
    seen.water = ['wall', 'bench', 'rail'];
    const result = await startSceneWarmup(target, schedule()).finished;
    expect(log).toEqual([
      'sauna:mirror:',
      'sauna:main:',
      'sauna:mirror:wall',
      'sauna:main:wall',
      'sauna:mirror:bench',
      'sauna:main:bench',
      // The rail is out of the sauna's view: stepped, but prepared only where it is drawn.
      'sauna:mirror:',
      'sauna:main:',
      'water:mirror:',
      'water:main:',
      'water:mirror:rail',
      'water:main:rail',
    ]);
    expect(own).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ steps: 12, groups: 3, undrawn: 0 });
  });

  it('restores visibility and render callbacks, leaving originally hidden materials alone', async () => {
    const { add, seen, target, schedule, root } = fixture();
    const wall = add('wall');
    const own = () => {};
    wall.onBeforeRender = own;
    const off = add('off');
    off.material.visible = false;
    seen.sauna = seen.water = ['wall', 'off'];
    const restore = vi.fn();
    const run = startSceneWarmup(target, { ...schedule(), restore });
    await run.finished;
    run.restore();
    expect(restore).toHaveBeenCalledOnce();
    expect(wall.onBeforeRender).toBe(own);
    expect(Object.prototype.hasOwnProperty.call(off, 'onBeforeRender')).toBe(false);
    root.traverse((object) => {
      const material = (object as THREE.Mesh).material as THREE.Material | undefined;
      if (material) expect(material.visible).toBe(object !== off);
    });
  });

  it('steps an undrawn group again in each view and reports it, without mirror steps out of sight', async () => {
    const { add, seen, mirrorInSight, log, target, schedule } = fixture();
    add('wall');
    add('far');
    seen.sauna = seen.water = ['wall'];
    mirrorInSight.water = false;
    const result = await startSceneWarmup(target, schedule()).finished;
    expect(log.filter((entry) => entry.startsWith('water:'))).toEqual(['water:main:', 'water:main:']);
    expect(result).toEqual({ steps: 8, groups: 2, undrawn: 1 });
  });

  it('rejects missing program metadata and an abort mid-run, restoring before it settles', async () => {
    const { add, seen, target, schedule, programs } = fixture();
    const wall = add('wall');
    seen.sauna = seen.water = ['wall'];
    programs.delete(wall.material);
    await expect(startSceneWarmup(target, schedule()).finished).rejects.toThrow('metadata unavailable');
    expect(wall.material.visible).toBe(true);

    programs.set(wall.material, { id: 9, vertexShader: {}, fragmentShader: {} });
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });
    try {
      const controller = new AbortController();
      const restore = vi.fn();
      const draw = target.draw;
      // Over the budget: the run waits for the browser after the first step.
      target.draw = (pass) => {
        vi.advanceTimersByTime(60);
        return draw(pass);
      };
      const run = startSceneWarmup(target, { ...schedule(), signal: controller.signal, restore });
      const settled = run.finished.catch((error: Error) => error.message);
      expect(wall.material.visible).toBe(false);
      // Disposal follows the abort at once: the owner restores before the run settles.
      controller.abort();
      run.restore();
      expect(wall.material.visible).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(wall, 'onBeforeRender')).toBe(false);
      expect(await settled).toContain('aborted');
      expect(vi.getTimerCount()).toBe(0);
      expect(restore).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
