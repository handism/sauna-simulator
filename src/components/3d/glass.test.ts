import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyGlass, fresnel, GLASS, slab } from './glass';
import { createIrradianceUniforms } from './irradiance';

describe('glass', () => {
  it('uses the dielectric Fresnel of the source IOR', () => {
    // Normal incidence: ((n - 1) / (n + 1))²; grazing: total reflection.
    expect(fresnel(1, 1.45)).toBeCloseTo((0.45 / 2.45) ** 2, 6);
    expect(fresnel(1e-4, 1.45)).toBeGreaterThan(0.999);
    // Rises monotonically toward grazing views.
    const angles = [1, 0.8, 0.5, 0.2, 0.05].map((c) => fresnel(c, 1.45));
    angles.slice(1).forEach((f, i) => expect(f).toBeGreaterThan(angles[i]));
  });

  it('matches the transmittance and reflectance of the source slab in Cycles', () => {
    const optics = GLASS['Low iron architectural glass'];
    // Blender 4.5 Cycles, the source material on an 18 mm slab (512 samples): white emitter
    // behind for T, white world minus that for R.
    for (const [degrees, transmittance, reflectance] of [
      [0, [0.8118, 0.8959, 0.8865], [0.0616, 0.0645, 0.0642]],
      [60, [0.7385, 0.8149, 0.8064], [0.1403, 0.1464, 0.1458]],
      [75, [0.5251, 0.5794, 0.5734], [0.3732, 0.3867, 0.3852]],
    ] as const) {
      const model = slab(Math.cos(THREE.MathUtils.degToRad(degrees)), optics);
      model.transmittance.forEach((t, i) => expect(Math.abs(t - transmittance[i])).toBeLessThan(0.01));
      model.reflectance.forEach((r, i) => expect(Math.abs(r - reflectance[i])).toBeLessThan(0.01));
    }
  });

  it('draws the transmittance with the original mesh, then the reflection on a copy', () => {
    const root = new THREE.Group();
    const source = new THREE.MeshStandardMaterial({ name: 'Low iron architectural glass', transparent: true });
    const glass = new THREE.Mesh(new THREE.BoxGeometry(), source);
    glass.castShadow = true;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name: 'Cedar' }));
    root.add(glass, wall);
    let disposed = false;
    source.addEventListener('dispose', () => (disposed = true));
    const uniforms = createIrradianceUniforms();
    expect(applyGlass(root, uniforms)).toBe(1);
    expect(disposed).toBe(true);
    const transmission = glass.material as unknown as THREE.ShaderMaterial;
    const [copy] = glass.children as THREE.Mesh[];
    const reflection = copy.material as THREE.ShaderMaterial;
    // dst × transmittance (a factor, not tone mapped), then dst + reflection.
    expect([transmission.blendSrc, transmission.blendDst, transmission.toneMapped]).toEqual([
      THREE.ZeroFactor,
      THREE.SrcColorFactor,
      false,
    ]);
    expect([reflection.blendSrc, reflection.blendDst, reflection.toneMapped]).toEqual([
      THREE.OneFactor,
      THREE.OneFactor,
      true,
    ]);
    // Same geometry and transform; the later id sorts after the transmittance.
    expect(copy.geometry).toBe(glass.geometry);
    expect(copy.id).toBeGreaterThan(glass.id);
    expect(copy.renderOrder).toBe(glass.renderOrder);
    expect([glass.castShadow, copy.castShadow, copy.receiveShadow]).toEqual([true, false, false]);
    // The probes are shared, not copied.
    expect(reflection.uniforms.suiProbeCourtyard).toBe(uniforms.suiProbeCourtyard);
    expect(reflection.uniforms.suiIrradianceEvening).toBe(uniforms.suiIrradianceEvening);
    expect(reflection.defines).toHaveProperty('SUI_REFLECTION');
    expect(wall.material).toBeInstanceOf(THREE.MeshStandardMaterial);
  });
});
