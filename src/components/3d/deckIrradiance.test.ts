import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createDeckIrradiance, isolateDeckReceivers } from './deckIrradiance';
import { applyIrradiance, createIrradianceUniforms } from './irradiance';

const header = {
  version: 1,
  width: 2,
  height: 2,
  min: [-5.5, 3.65],
  max: [5.5, 4.55],
  level: 0.065,
  scenes: ['evening', 'night'],
};
const buffer = () => new Uint16Array(32).fill(THREE.DataUtils.toHalfFloat(1)).buffer;

describe('deck surface irradiance', () => {
  it('loads the shipped bake with the matching source and binary hash', () => {
    const shipped = JSON.parse(readFileSync('public/models/deck-irradiance.json', 'utf8'));
    const probes = JSON.parse(readFileSync('public/models/irradiance.json', 'utf8'));
    const bytes = readFileSync('public/models/deck-irradiance.bin');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(shipped.bin_sha256);
    expect(shipped.input_sha256).toBe(probes.input_sha256);
    const light = createDeckIrradiance(
      shipped,
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    expect(light.texture.image.depth).toBe(2);
    light.dispose();
  });
  it('rejects malformed, truncated, negative and nonfinite lighting data', () => {
    for (const changed of [
      { width: 0 },
      { width: 1.5 },
      { scenes: ['night', 'evening'] },
      { min: [6, 4] },
      { level: NaN },
    ])
      expect(() => createDeckIrradiance({ ...header, ...changed }, buffer())).toThrow();
    expect(() => createDeckIrradiance(header, new ArrayBuffer(1))).toThrow();
    for (const bad of [0x7c00, 0x7e00, 0xbc00]) {
      const bytes = new Uint16Array(buffer());
      bytes[0] = bad;
      expect(() => createDeckIrradiance(header, bytes.buffer)).toThrow();
    }
  });

  it('separates the stone tops without duplicating triangles or changing other faces and materials', () => {
    const root = new THREE.Group();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [0, 0.065, 3.8, 1, 0.065, 3.8, 0, 0.065, 4.4, 0, 0.2, -2, 1, 0.2, -2, 0, 0.2, -3],
        3,
      ),
    );
    geometry.setIndex([0, 1, 2, 3, 4, 5]);
    const material = new THREE.MeshStandardMaterial();
    material.name = 'V2 | mineral charcoal stone';
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    expect(isolateDeckReceivers(root)).toBe(1);
    expect(Array.from(geometry.index!.array)).toEqual([3, 4, 5]);
    const receiver = mesh.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect(Array.from(receiver.geometry.index!.array)).toEqual([0, 1, 2]);
    expect(receiver.geometry.getAttribute('position')).toBe(geometry.getAttribute('position'));
    expect(receiver.material).not.toBe(material);
    expect(receiver.material.name).toBe(material.name);
    expect(receiver.castShadow && receiver.receiveShadow).toBe(true);
    expect(isolateDeckReceivers(root)).toBe(0);
    const light = createDeckIrradiance(header, buffer());
    applyIrradiance(root, createIrradianceUniforms());
    expect(light.apply(root)).toBe(1);
    expect(light.apply(root)).toBe(0);
    expect(material.defines?.SUI_DECK_IRRADIANCE).toBeUndefined();
    expect(receiver.material.defines?.SUI_DECK_IRRADIANCE).toBe('');
    const release = vi.spyOn(light.texture, 'dispose');
    light.dispose();
    expect(release).toHaveBeenCalledOnce();
  });
});
