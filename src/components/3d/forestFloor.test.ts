import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { patchAutumnGroundShader } from './autumnGround';
import { canopyCoverage, createForestFloor, FLOOR_EXTENT, FLOOR_SIZE, patchForestFloorShader } from './forestFloor';
import { patchSurfaceDetailShader } from './surfaceDetails';

const standard = () => ({
  vertexShader: THREE.ShaderLib.standard.vertexShader,
  fragmentShader: THREE.ShaderLib.standard.fragmentShader,
});
const texelOf = (x: number, z: number) => {
  const texel = (2 * FLOOR_EXTENT) / FLOOR_SIZE;
  return Math.floor((z + FLOOR_EXTENT) / texel) * FLOOR_SIZE + Math.floor((x + FLOOR_EXTENT) / texel);
};

describe('forest floor', () => {
  it('shades the ground under a crown and fades out past its rim', () => {
    const cover = canopyCoverage([{ x: 20, z: -10, rx: 2, rz: 3 }]);
    expect(cover[texelOf(20, -10)]).toBeGreaterThan(200);
    expect(cover[texelOf(21.5, -10)]).toBeGreaterThan(0);
    expect(cover[texelOf(25, -10)]).toBe(0);
    // Longer along z, where the crown is wider.
    expect(cover[texelOf(20, -14)]).toBeGreaterThan(cover[texelOf(24, -10)]);
    expect(cover[texelOf(0, 0)]).toBe(0);
  });

  it('adds overlapping crowns without passing full cover', () => {
    const one = canopyCoverage([{ x: 0, z: 0, rx: 2, rz: 2 }]);
    const two = canopyCoverage([
      { x: 0, z: 0, rx: 2, rz: 2 },
      { x: 1, z: 0, rx: 2, rz: 2 },
    ]);
    expect(two[texelOf(0, 0)]).toBeGreaterThan(one[texelOf(0, 0)]);
    expect(Math.max(...two)).toBeLessThanOrEqual(255);
  });

  it('keeps crowns beyond the map from writing outside it', () => {
    expect(canopyCoverage([{ x: FLOOR_EXTENT + 1, z: 0, rx: 3, rz: 3 }]).length).toBe(FLOOR_SIZE * FLOOR_SIZE);
  });

  it('runs after the ground details and before the autumn leaves', () => {
    const shader = standard();
    patchSurfaceDetailShader(shader, 'ground');
    patchForestFloorShader(shader);
    patchAutumnGroundShader(shader);
    const at = (text: string) => shader.fragmentShader.indexOf(text);
    const floor = at('float suiFloor');
    expect(floor).toBeGreaterThan(at('float suiDry'));
    expect(floor).toBeLessThan(at('if (suiAutumnGround > 0.0)'));
    expect(floor).toBeLessThan(at('#include <roughnessmap_fragment>'));
    expect(shader.fragmentShader).toContain('uniform sampler2D suiCanopyMap;');
  });

  it('needs the ground details', () => {
    const shader = standard();
    patchSurfaceDetailShader(shader, 'stone');
    expect(() => patchForestFloorShader(shader)).toThrow();
  });

  it('patches only the ground materials, once, and fills the shared map later', () => {
    const root = new THREE.Group();
    for (const name of ['V9 | layered living moss', 'V3 | moss and woodland earth', 'V2 | pale mineral paving'])
      root.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ name })));
    const floor = createForestFloor();
    expect(floor.apply(root)).toBe(2);
    expect(floor.apply(root)).toBe(0);
    const version = floor.texture.version;
    floor.update([{ x: 0, z: 0, rx: 2, rz: 2 }]);
    expect(floor.texture.version).toBeGreaterThan(version);
    expect((floor.texture.image.data as Uint8Array)[texelOf(0, 0)]).toBeGreaterThan(200);
    floor.dispose();
  });
});
