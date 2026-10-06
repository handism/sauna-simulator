import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { collectWarmupGroups } from './warmupPrograms';
import type { WarmupPass } from './warmupPasses';

function fixture(length = 60001) {
  const vertexShader = {} as WebGLShader;
  const fragmentShader = {} as WebGLShader;
  const program = { id: 0, vertexShader, fragmentShader };
  const getShaderSource = vi.fn((shader: WebGLShader) => (shader === vertexShader ? 'v'.repeat(length - 1) : 'f'));
  const get = vi.fn(() => ({ currentProgram: program }));
  const renderer = { properties: { get }, getContext: () => ({ getShaderSource }) } as unknown as THREE.WebGLRenderer;
  const eligible = new Map<THREE.Material, Set<WarmupPass>>();
  const add = (pass: WarmupPass) => {
    const material = new THREE.MeshBasicMaterial();
    eligible.set(material, new Set([pass]));
    return material;
  };
  return { renderer, eligible, add, get, getShaderSource };
}

describe('warmup program adapter', () => {
  it('unions eligible passes for shared program/state and reads each source once', () => {
    const { renderer, eligible, add, getShaderSource } = fixture();
    const main = add('main');
    const mirror = add('mirror');
    const groups = [...collectWarmupGroups(renderer, eligible).values()];
    expect(groups).toEqual([{ materials: [main, mirror], passes: new Set(['main', 'mirror']) }]);
    expect(getShaderSource).toHaveBeenCalledTimes(2);
  });

  it('separates material state and recollects state changes', () => {
    const { renderer, eligible, add } = fixture();
    add('main');
    const other = add('main');
    other.colorWrite = false;
    expect(collectWarmupGroups(renderer, eligible).size).toBe(2);
    other.colorWrite = true;
    expect(collectWarmupGroups(renderer, eligible).size).toBe(1);
    other.blendSrcAlpha = THREE.OneFactor;
    expect(collectWarmupGroups(renderer, eligible).size).toBe(2);
  });

  it('excludes the threshold, hidden materials and unreachable passes without mutation', () => {
    const { renderer, eligible, add, get } = fixture(60000);
    add('main');
    const hidden = add('main');
    hidden.visible = false;
    eligible.set(add('mirror'), new Set());
    expect(collectWarmupGroups(renderer, eligible).size).toBe(0);
    expect(get).toHaveBeenCalledTimes(1);
    expect(hidden.visible).toBe(false);
  });

  it('rejects missing internal metadata and unavailable source instead of treating it as cheap', () => {
    const { renderer, eligible, add, get, getShaderSource } = fixture();
    add('main');
    getShaderSource.mockReturnValue('');
    expect(() => collectWarmupGroups(renderer, eligible)).toThrow('source unavailable');
    get.mockReturnValue({} as ReturnType<typeof get>);
    expect(() => collectWarmupGroups(renderer, eligible)).toThrow('metadata unavailable');
  });
});
