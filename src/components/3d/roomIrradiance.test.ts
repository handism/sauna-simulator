import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRoomIrradiance, isolateRoomReceivers, type RoomIrradianceHeader } from './roomIrradiance';
import { applyIrradiance, createIrradianceUniforms } from './irradiance';

const header: RoomIrradianceHeader = {
  version: 3,
  width: 2,
  height: 2,
  scenes: ['day', 'evening', 'night'],
  surfaces: JSON.parse(readFileSync('public/models/room-irradiance.json', 'utf8')).surfaces.map(
    (p: RoomIrradianceHeader['surfaces'][number]) => ({ ...p, width: 2, height: 2 }),
  ),
};
const buffer = () => new Uint16Array(2 * 2 * 12 * 4).fill(THREE.DataUtils.toHalfFloat(1)).buffer;

describe('room surface irradiance', () => {
  it('loads the shipped bake with matching binary and source hashes', () => {
    const shipped = JSON.parse(readFileSync('public/models/room-irradiance.json', 'utf8'));
    const probes = JSON.parse(readFileSync('public/models/irradiance.json', 'utf8'));
    const bytes = readFileSync('public/models/room-irradiance.bin');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(shipped.bin_sha256);
    expect(shipped.input_sha256).toBe(probes.input_sha256);
    const light = createRoomIrradiance(
      shipped,
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    expect(light.texture.image.depth).toBe(12);
    light.dispose();
  });
  it('rejects invalid layout, sample validity and nonfinite/negative irradiance', () => {
    for (const changed of [{ width: 1 }, { height: 2.1 }, { scenes: ['night', 'evening', 'day'] }, { surfaces: [] }])
      expect(() => createRoomIrradiance({ ...header, ...changed }, buffer())).toThrow();
    expect(() => createRoomIrradiance(header, new ArrayBuffer(1))).toThrow();
    for (const [index, value] of [
      [0, 0x7c00],
      [0, 0xbc00],
      [3, 0x4000],
    ]) {
      const bytes = new Uint16Array(buffer());
      bytes[index] = value;
      expect(() => createRoomIrradiance(header, bytes.buffer)).toThrow();
    }
    const mismatched = new Uint16Array(buffer());
    mismatched[6 * 2 * 2 * 4 + 3] = 0;
    expect(() => createRoomIrradiance(header, mismatched.buffer)).toThrow('validity');
  });
  it('partitions only room faces in world coordinates, preserving attributes and other wood', () => {
    const root = new THREE.Group();
    const geometry = new THREE.BufferGeometry();
    // A room floor triangle and an outdoor board at the same height.
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-4, 0.1, -4, -3, 0.1, -4, -4, 0.1, -3, 0, 0.1, 2, 1, 0.1, 2, 0, 0.1, 3], 3),
    );
    geometry.setIndex([0, 1, 2, 3, 4, 5]);
    const material = new THREE.MeshStandardMaterial();
    material.name = 'V2 | outdoor ash / grain & wear';
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    expect(isolateRoomReceivers(root)).toBe(1);
    expect(Array.from(geometry.index!.array)).toEqual([3, 4, 5]);
    const receiver = mesh.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect(receiver.geometry.getAttribute('position')).toBe(geometry.getAttribute('position'));
    expect(Array.from(receiver.geometry.index!.array)).toEqual([0, 1, 2]);
    expect(receiver.castShadow && receiver.receiveShadow).toBe(true);
    expect(isolateRoomReceivers(root)).toBe(0);
    const light = createRoomIrradiance(header, buffer());
    applyIrradiance(root, createIrradianceUniforms());
    expect(light.apply(root)).toBe(1);
    expect(light.apply(root)).toBe(0);
    expect(material.defines?.SUI_ROOM_IRRADIANCE).toBeUndefined();
    expect(receiver.material.defines?.SUI_ROOM_IRRADIANCE).toBe('');
    const disposed = vi.spyOn(light.texture, 'dispose');
    light.dispose();
    expect(disposed).toHaveBeenCalledOnce();
    const transformed = new THREE.Group();
    const moved = new THREE.Mesh(receiver.geometry.clone(), material);
    moved.position.x = 20;
    transformed.add(moved);
    expect(isolateRoomReceivers(transformed)).toBe(0);
  });
  it('separates each new receiver plane but excludes a triangle joining different planes and other cedar', () => {
    const root = new THREE.Group();
    const planes = [
      [-4, 1.035, -3.8, -3, 1.035, -3.8, -4, 1.035, -3.4],
      [-4, 0.565, -2.9, -3, 0.565, -2.9, -4, 0.565, -2.6],
      [-6.0925, 1, -3.8, -6.0925, 2, -3.8, -6.0925, 1, -3],
      [-4, 3.285, -3.8, -3, 3.285, -3.8, -4, 3.285, -3],
      // One vertex on each of upper bench, left wall, and ceiling.
      [-4, 1.035, -3.8, -6.0925, 2, -3.8, -4, 3.285, -3],
      [-4, 1.2, -3.8, -3, 1.2, -3.8, -4, 1.2, -3],
    ];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(planes.flat(), 3));
    geometry.setIndex(Array.from({ length: 18 }, (_, i) => i));
    const material = new THREE.MeshStandardMaterial();
    material.name = 'V2 | warm open-grain timber';
    const mesh = new THREE.Mesh(geometry, material);
    root.add(mesh);
    expect(isolateRoomReceivers(root)).toBe(4);
    expect(Array.from(geometry.index!.array)).toEqual([12, 13, 14, 15, 16, 17]);
    const receiver = mesh.children[0] as THREE.Mesh;
    expect(receiver.geometry.getAttribute('position')).toBe(geometry.getAttribute('position'));
    expect(receiver.geometry.index!.count + geometry.index!.count).toBe(18);
    expect(isolateRoomReceivers(root)).toBe(0);
  });
  it('includes bench slat sides/undersides, shielding lips and the backrest, but not outdoor boards', () => {
    const cedar = [
      // Upper bench slat vertical side (y 0.965..1.03) and underside.
      [-4, 0.97, -3.5, -3, 0.97, -3.5, -4, 1.03, -3.5],
      [-4, 0.965, -3.6, -3, 0.965, -3.6, -4, 0.965, -3.5],
      // Lower bench front nosing.
      [-4, 0.5, -2.51, -3, 0.5, -2.51, -4, 0.56, -2.51],
      // Backrest slat in front of the rear wall.
      [-4, 1.3, -4.4, -3, 1.3, -4.4, -4, 1.4, -4.4],
      // Same height as the upper bench, but outside the room.
      [0, 1.0, 2, 1, 1.0, 2, 0, 1.0, 3],
    ];
    const floor = [
      // Light-shielding lip under the upper bench.
      [-4, 0.75, -3.3, -3, 0.75, -3.3, -4, 0.9, -3.3],
      // Floor near the right glass edge, in front of the benches.
      [-1.0, 0.085, -1.0, -0.6, 0.085, -1.0, -1.0, 0.085, -0.5],
    ];
    const root = new THREE.Group();
    for (const [name, tris] of [
      ['V2 | warm open-grain timber', cedar],
      ['V2 | outdoor ash / grain & wear', floor],
    ] as const) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
      geometry.setIndex(Array.from({ length: tris.length * 3 }, (_, i) => i));
      const material = new THREE.MeshStandardMaterial();
      material.name = name;
      root.add(new THREE.Mesh(geometry, material));
    }
    expect(isolateRoomReceivers(root)).toBe(6);
    const [cedarMesh, floorMesh] = root.children as THREE.Mesh[];
    expect(Array.from(cedarMesh.geometry.index!.array)).toEqual([12, 13, 14]);
    expect(floorMesh.geometry.index!.count).toBe(0);
  });
  it('chains material hooks without changing the shared lighting uniforms', () => {
    const root = new THREE.Group(),
      material = new THREE.MeshStandardMaterial();
    material.userData.suiRoomReceiver = true;
    const hook = vi.fn();
    material.onBeforeCompile = hook;
    material.customProgramCacheKey = () => 'prior-hook';
    root.add(new THREE.Mesh(new THREE.PlaneGeometry(), material));
    const light = createRoomIrradiance(header, buffer());
    const lighting = createIrradianceUniforms();
    applyIrradiance(root, lighting);
    light.apply(root);
    const shader = { uniforms: {} } as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(hook).toHaveBeenCalledOnce();
    expect(shader.uniforms.suiIrradianceNight).toBe(lighting.suiIrradianceNight);
    expect(shader.uniforms.suiRoomIrradiance.value).toBe(light.texture);
    expect(material.customProgramCacheKey()).toContain('prior-hook|room-irradiance-v3');
    light.dispose();
  });
});
