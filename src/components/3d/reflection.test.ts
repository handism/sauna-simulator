import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import irradianceHeader from '../../../public/models/irradiance.json';
import reflectionHeader from '../../../public/models/reflection.json';
import { IRRADIANCE_LINE, applyIrradiance, createIrradianceUniforms } from './irradiance';
import { REFLECTION_LINE, applyReflection } from './reflection';

describe('baked reflection probes', () => {
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
    expect(applyReflection(root, irradiance)).toBe(1);
    expect(lit.defines).toHaveProperty('SUI_REFLECTION');
    expect(unlit.defines ?? {}).not.toHaveProperty('SUI_REFLECTION');
    const shader = { uniforms: {}, fragmentShader: '' } as unknown as THREE.WebGLProgramParametersWithUniforms;
    lit.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.suiIrradianceEvening).toBe(irradiance.suiIrradianceEvening);
    // The reflection lives in the irradiance grid textures (no texture units of its own).
    expect(shader.uniforms.suiProbeRoom).toBe(irradiance.suiProbeRoom);
    expect(THREE.ShaderChunk.lights_pars_begin).toContain('SUI_REFLECTION_KIND );');
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

  it('ships a bake of the same input as the irradiance probes', () => {
    expect(reflectionHeader.input_sha256).toBe(irradianceHeader.input_sha256);
  });
});
