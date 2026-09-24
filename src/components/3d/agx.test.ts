import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { agx } from './agx';

const encode = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

describe('Blender AgX tone mapping', () => {
  it("matches Blender 4.5's OCIO AgX view for greys", () => {
    // PyOpenColorIO 2.4.1, Blender 4.5 config: Linear Rec.709 -> sRGB display, AgX view.
    for (const [input, display] of [
      [0.01, 0.0725],
      [0.18, 0.4614],
      [1, 0.771],
    ]) {
      for (const channel of agx([input, input, input])) expect(encode(channel)).toBeCloseTo(display, 2);
    }
    // Exposure scales the scene-linear input, as three's toneMappingExposure does.
    expect(agx([0.09, 0.09, 0.09], 2)).toEqual(agx([0.18, 0.18, 0.18]));
  });

  it("replaces only three's AgX function of the shared chunk", () => {
    const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
    expect(chunk.match(/vec3 AgXToneMapping\(/g)).toHaveLength(1);
    expect(chunk).toContain('float curve[ 32 ]');
    expect(chunk).not.toContain('agxDefaultContrastApprox( color )');
    expect(chunk).toContain('vec3 NeutralToneMapping(');
  });
});
