import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import irradianceHeader from '../../../public/models/irradiance.json';
import reflectionHeader from '../../../public/models/reflection.json';
import {
  GRID_NAMES,
  IRRADIANCE_LINE,
  applyIrradiance,
  createIrradianceUniforms,
  type IrradianceHeader,
} from './irradiance';
import { REFLECTION_LINE, applyReflection, createReflectionTextures, createReflectionUniforms } from './reflection';

function fixture(max = 1) {
  const perScene = 8 * 27;
  const grids = GRID_NAMES.map((name, g) => ({
    name,
    min: [0, 0, 0] as [number, number, number],
    max: [max, 1, 1] as [number, number, number],
    resolution: [2, 2, 2] as [number, number, number],
    offset: { day: 2 * g * perScene, evening: (2 * g + 1) * perScene },
  }));
  return { header: { scenes: ['day', 'evening'], grids }, buffer: new Uint16Array(6 * perScene).buffer };
}

describe('baked reflection probes', () => {
  it('needs the grids of the irradiance probes and fills its own textures', () => {
    const { header, buffer } = fixture();
    expect(() => createReflectionTextures(fixture(2).header, header, buffer)).toThrow();
    const reflection = createReflectionTextures(header, header, buffer);
    const uniforms = createReflectionUniforms();
    reflection.apply(uniforms);
    expect(uniforms.suiReflectionOuter.value).toBeInstanceOf(THREE.Data3DTexture);
    reflection.dispose();
  });

  it('reflects on the probe-lit materials only and keeps earlier hooks', () => {
    const lit = new THREE.MeshStandardMaterial();
    const unlit = new THREE.MeshStandardMaterial();
    const root = new THREE.Group().add(
      new THREE.Mesh(new THREE.BoxGeometry(), lit),
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()),
    );
    const irradiance = createIrradianceUniforms();
    applyIrradiance(root, irradiance);
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), unlit));
    const uniforms = createReflectionUniforms();
    expect(applyReflection(root, uniforms)).toBe(1);
    expect(lit.defines).toHaveProperty('SUI_REFLECTION');
    expect(unlit.defines ?? {}).not.toHaveProperty('SUI_REFLECTION');
    const shader = { uniforms: {}, fragmentShader: '' } as unknown as THREE.WebGLProgramParametersWithUniforms;
    lit.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.suiIrradianceEvening).toBe(irradiance.suiIrradianceEvening);
    expect(shader.uniforms.suiReflectionRoom).toBe(uniforms.suiReflectionRoom);
  });

  it('adds the probe radiance once, after the irradiance and before the indirect specular', () => {
    const begin = THREE.ShaderChunk.lights_fragment_begin;
    expect(begin.split(REFLECTION_LINE)).toHaveLength(2);
    const at = begin.indexOf(REFLECTION_LINE);
    expect(at).toBeGreaterThan(begin.indexOf('vec3 radiance = vec3( 0.0 );'));
    expect(at).toBeGreaterThan(begin.indexOf(IRRADIANCE_LINE));
    expect(THREE.ShaderChunk.lights_fragment_maps).toContain('radiance += iblRadiance;');
    expect(THREE.ShaderChunk.lights_fragment_end).toContain('RE_IndirectSpecular( radiance,');
    expect(THREE.ShaderChunk.lights_pars_begin).toContain('vec3 suiReflection(');
  });

  it('ships a bake on the grids of the shipped irradiance probes', () => {
    const buffer = readFileSync('public/models/reflection.bin');
    const reflection = createReflectionTextures(
      irradianceHeader as unknown as IrradianceHeader,
      reflectionHeader as unknown as IrradianceHeader,
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    );
    reflection.dispose();
    expect(reflectionHeader.input_sha256).toBe(irradianceHeader.input_sha256);
  });
});
