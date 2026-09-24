import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import header from '../../../public/models/irradiance.json';
import { INTERIOR_BOX } from './interiorLights';
import {
  GRID_NAMES,
  IRRADIANCE_LINE,
  applyIrradiance,
  createIrradianceTextures,
  createIrradianceUniforms,
  type IrradianceHeader,
} from './irradiance';

const bundled = header as unknown as IrradianceHeader;

// Probe values encode (grid, scene, probe, coefficient) so the packing can be traced.
function fixture(resolution: [number, number, number]) {
  const perScene = resolution.reduce((a, b) => a * b) * 27;
  const grids = GRID_NAMES.map((name, g) => ({
    name,
    min: [0, 0, 0] as [number, number, number],
    max: [1, 2, 3] as [number, number, number],
    resolution,
    offset: { day: 2 * g * perScene, evening: (2 * g + 1) * perScene },
  }));
  const data = new Uint16Array(6 * perScene).map((_, i) => i % 60000);
  return { header: { scenes: ['day', 'evening'], grids }, buffer: data.buffer, data, perScene };
}

describe('baked irradiance probes', () => {
  it('packs 27 coefficients into 7 padded sub-volumes per scene', () => {
    const { header, buffer, data } = fixture([2, 3, 4]);
    const irradiance = createIrradianceTextures(header, buffer);
    const uniforms = createIrradianceUniforms();
    irradiance.apply(uniforms);
    expect(irradiance.probes).toBe(3 * 24);
    const texture = uniforms.suiIrradianceCourtyard.value!;
    const { width, height, depth } = texture.image;
    const slices = 4 + 2;
    expect([width, height, depth]).toEqual([2, 3, 14 * slices]);
    expect(texture.type).toBe(THREE.HalfFloatType);
    const texels = texture.image.data as Uint16Array;
    const at = (x: number, y: number, slice: number, c: number) => texels[((slice * 3 + y) * 2 + x) * 4 + c];
    const probe = (scene: number, x: number, y: number, z: number, k: number) =>
      data[header.grids[1].offset[scene ? 'evening' : 'day'] + ((z * 3 + y) * 2 + x) * 27 + k];
    // Evening (sub-volumes 7..13), texel 2 holds coefficients 8..11, probe (1, 2, 3).
    const base = (7 + 2) * slices;
    for (let c = 0; c < 4; c++) expect(at(1, 2, base + 1 + 3, c)).toBe(probe(1, 1, 2, 3, 8 + c));
    // Padding repeats the first and last data slice; the 28th channel is unused.
    expect(at(0, 1, base, 0)).toBe(probe(1, 0, 1, 0, 8));
    expect(at(0, 1, base + 5, 0)).toBe(probe(1, 0, 1, 3, 8));
    expect(at(0, 0, 6 * slices + 1, 3)).toBe(0);
    expect(uniforms.suiIrradianceMax.value[1].toArray()).toEqual([1, 2, 3]);
    expect(uniforms.suiIrradianceRes.value[2].toArray()).toEqual([2, 3, 4]);
    const released: string[] = [];
    for (const map of [uniforms.suiIrradianceRoom, uniforms.suiIrradianceCourtyard, uniforms.suiIrradianceOuter])
      map.value!.addEventListener('dispose', () => released.push('texture'));
    irradiance.dispose();
    expect(released).toHaveLength(3);
  });

  it('rejects a layout that does not match the data', () => {
    const { header, buffer } = fixture([2, 2, 2]);
    expect(() => createIrradianceTextures(header, buffer.slice(2))).toThrow();
    expect(() => createIrradianceTextures({ ...header, scenes: ['day'] }, buffer)).toThrow();
    expect(() => createIrradianceTextures({ ...header, grids: header.grids.slice(1) }, buffer)).toThrow();
    const flat = structuredClone(header);
    flat.grids[0].resolution = [1, 2, 2];
    expect(() => createIrradianceTextures(flat, buffer)).toThrow();
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
    expect(begin.indexOf('bool suiInterior')).toBeLessThan(begin.indexOf(IRRADIANCE_LINE));
  });

  it('ships a bake that matches its layout and the room box', () => {
    const buffer = readFileSync('public/models/irradiance.bin');
    const irradiance = createIrradianceTextures(
      bundled,
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    );
    irradiance.dispose();
    const [room, courtyard, outer] = bundled.grids;
    const box = (grid: (typeof bundled.grids)[number]) =>
      new THREE.Box3(new THREE.Vector3(...grid.min), new THREE.Vector3(...grid.max));
    // Room probes stay inside the room; the courtyard grid covers the room and lies inside the outer one.
    expect(INTERIOR_BOX.containsBox(box(room))).toBe(true);
    expect(box(courtyard).containsBox(box(room))).toBe(true);
    expect(box(outer).containsBox(box(courtyard))).toBe(true);
  });
});
