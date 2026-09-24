import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import header from '../../../public/models/irradiance.json';
import { INTERIOR_BOX, WATER_BOX } from './interiorLights';
import {
  GRID_NAMES,
  IRRADIANCE_LINE,
  applyIrradiance,
  createIrradianceUniforms,
  createProbeTextures,
  type IrradianceHeader,
  type ProbeFile,
} from './irradiance';

const bundled = header as unknown as IrradianceHeader;

// Probe values encode (file, grid, scene, probe, coefficient) so the packing can be traced.
function fixture(resolution: [number, number, number], shift = 0) {
  const perScene = resolution.reduce((a, b) => a * b) * 27;
  const grids = GRID_NAMES.map((name, g) => ({
    name,
    min: [0, 0, 0] as [number, number, number],
    max: [1, 2, 3] as [number, number, number],
    resolution,
    offset: { day: 2 * g * perScene, evening: (2 * g + 1) * perScene },
  }));
  const data = new Uint16Array(2 * GRID_NAMES.length * perScene).map((_, i) => (i + shift) % 60000);
  return { header: { scenes: ['day', 'evening'], grids }, buffer: data.buffer, data, perScene };
}
const shipped = (name: string): ProbeFile => {
  const buffer = readFileSync(`public/models/${name}.bin`);
  return {
    header: JSON.parse(readFileSync(`public/models/${name}.json`, 'utf8')),
    buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
};

describe('baked irradiance probes', () => {
  it('packs the irradiance and the reflection of a grid into 28 padded sub-volumes', () => {
    const irradianceFile = fixture([2, 3, 4]);
    const reflectionFile = fixture([2, 3, 4], 17);
    const probes = createProbeTextures(irradianceFile, reflectionFile);
    const uniforms = createIrradianceUniforms();
    probes.apply(uniforms);
    expect(probes.probes).toBe(GRID_NAMES.length * 24);
    const texture = uniforms.suiProbeCourtyard.value!;
    const { width, height, depth } = texture.image;
    const slices = 4 + 2;
    expect([width, height, depth]).toEqual([2, 3, 28 * slices]);
    expect(texture.type).toBe(THREE.HalfFloatType);
    const texels = texture.image.data as Uint16Array;
    const at = (x: number, y: number, slice: number, c: number) => texels[((slice * 3 + y) * 2 + x) * 4 + c];
    const probe = (file: typeof irradianceFile, scene: number, x: number, y: number, z: number, k: number) =>
      file.data[file.header.grids[1].offset[scene ? 'evening' : 'day'] + ((z * 3 + y) * 2 + x) * 27 + k];
    // Irradiance evening (sub-volumes 7..13), texel 2 holds coefficients 8..11, probe (1, 2, 3).
    let base = (7 + 2) * slices;
    for (let c = 0; c < 4; c++) expect(at(1, 2, base + 1 + 3, c)).toBe(probe(irradianceFile, 1, 1, 2, 3, 8 + c));
    // Padding repeats the first and last data slice; the 28th channel is unused.
    expect(at(0, 1, base, 0)).toBe(probe(irradianceFile, 1, 0, 1, 0, 8));
    expect(at(0, 1, base + 5, 0)).toBe(probe(irradianceFile, 1, 0, 1, 3, 8));
    expect(at(0, 0, 6 * slices + 1, 3)).toBe(0);
    // Reflection day and evening follow (sub-volumes 14..27).
    base = (14 + 2) * slices;
    for (let c = 0; c < 4; c++) expect(at(1, 2, base + 1 + 3, c)).toBe(probe(reflectionFile, 0, 1, 2, 3, 8 + c));
    base = (21 + 6) * slices;
    expect(at(0, 1, base + 1, 0)).toBe(probe(reflectionFile, 1, 0, 1, 0, 24));
    expect(uniforms.suiIrradianceMax.value[1].toArray()).toEqual([1, 2, 3]);
    expect(uniforms.suiIrradianceRes.value[2].toArray()).toEqual([2, 3, 4]);
    const released: string[] = [];
    for (const map of [
      uniforms.suiProbeRoom,
      uniforms.suiProbeCourtyard,
      uniforms.suiProbeOuter,
      uniforms.suiProbeWater,
    ])
      map.value!.addEventListener('dispose', () => released.push('texture'));
    probes.dispose();
    expect(released).toHaveLength(4);
  });

  it('rejects a layout that does not match the data or the other file', () => {
    const file = fixture([2, 2, 2]);
    const create =
      (header: IrradianceHeader, buffer = file.buffer) =>
      () =>
        createProbeTextures({ header, buffer }, file);
    expect(create(file.header, file.buffer.slice(2))).toThrow('irradiance');
    expect(create({ ...file.header, scenes: ['day'] })).toThrow();
    expect(create({ ...file.header, grids: file.header.grids.slice(1) })).toThrow();
    const flat = structuredClone(file.header);
    flat.grids[0].resolution = [1, 2, 2];
    expect(create(flat)).toThrow();
    const moved = structuredClone(file.header);
    moved.grids[3].max = [2, 2, 3];
    expect(() => createProbeTextures(file, { header: moved, buffer: file.buffer })).toThrow('reflection');
  });

  it('lights model materials through the probe line and keeps earlier hooks', () => {
    const uniforms = createIrradianceUniforms();
    const leaf = Object.assign(new THREE.MeshStandardMaterial(), { name: 'V5 forest leaf 0' });
    leaf.onBeforeCompile = (shader) => {
      shader.fragmentShader = `// earlier hook\n${shader.fragmentShader}`;
    };
    const root = new THREE.Group().add(
      new THREE.Mesh(new THREE.BoxGeometry(), leaf),
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhysicalMaterial()),
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()),
    );
    expect(applyIrradiance(root, uniforms)).toBe(2);
    expect(leaf.defines).toHaveProperty('SUI_IRRADIANCE');
    const shader = {
      uniforms: {},
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    leaf.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.suiIrradianceEvening).toBe(uniforms.suiIrradianceEvening);
    // The probe line lives in the shared chunk (checked below).
    expect(shader.fragmentShader).toContain('#include <lights_fragment_begin>');
    expect(shader.fragmentShader).toContain('// earlier hook');
    expect(THREE.ShaderChunk.lights_pars_begin).toContain('vec3 suiIrradiance(');
    // The probes are added once, before (and instead of) any hemisphere light.
    const begin = THREE.ShaderChunk.lights_fragment_begin;
    expect(begin.split(IRRADIANCE_LINE)).toHaveLength(2);
    expect(begin.indexOf(IRRADIANCE_LINE)).toBeLessThan(begin.indexOf('NUM_HEMI_LIGHTS'));
    expect(begin.indexOf('bool suiUnderwater')).toBeLessThan(begin.indexOf(IRRADIANCE_LINE));
  });

  it('ships bakes that match their layout and the room and water boxes', () => {
    createProbeTextures(shipped('irradiance'), shipped('reflection')).dispose();
    expect(shipped('reflection').header).toMatchObject({ input_sha256: header.input_sha256 });
    const [room, courtyard, outer, water] = bundled.grids;
    const box = (grid: (typeof bundled.grids)[number]) =>
      new THREE.Box3(new THREE.Vector3(...grid.min), new THREE.Vector3(...grid.max));
    // Room probes stay inside the room; the courtyard grid covers the room and lies inside the outer one.
    expect(INTERIOR_BOX.containsBox(box(room))).toBe(true);
    expect(box(courtyard).containsBox(box(room))).toBe(true);
    expect(box(outer).containsBox(box(courtyard))).toBe(true);
    // Water probes lie below the surface, where fragments use them, and away from the room.
    expect(WATER_BOX.containsBox(box(water))).toBe(true);
    expect(WATER_BOX.intersectsBox(INTERIOR_BOX)).toBe(false);
  });
});
