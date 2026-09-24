import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BLOCKER_SAMPLES, FACING_NORMAL_BIAS, FILTER_SAMPLES, directionalPenumbra, spotPenumbra } from './softShadows';

describe('soft shadows', () => {
  it('replaces only the BasicShadowMap filter of the shared chunk', () => {
    const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
    expect(chunk.match(/float getShadow\( sampler2D shadowMap/g)).toHaveLength(2);
    expect(chunk).toContain('pcssDisk');
    expect(chunk).toContain(`i < ${BLOCKER_SAMPLES}`);
    expect(chunk).toContain(`${FILTER_SAMPLES}.0`);
    // The PCF and VSM branches stay as three ships them.
    expect(chunk).toContain('sampler2DShadow shadowMap');
    expect(chunk).toContain('#elif defined( SHADOWMAP_TYPE_VSM )');
  });

  it('maps the source light size to a penumbra per unit of stored depth', () => {
    // Orthographic: a 4.9° sun blurs a shadow 1 m below its blocker by about 8.5 cm.
    const camera = new THREE.OrthographicCamera(-30, 30, 30, -30, 0.1, 110.1);
    const k = directionalPenumbra(camera, 0.085);
    expect(k * (1 / 110) * 60).toBeCloseTo(0.085, 3);
    // Perspective: a blocker 3 m and a receiver 7 m from a 1.25 m disk give a 1.67 m penumbra.
    const [near, far, fov] = [1, 20, 144];
    const depth = (d: number) => (far / (far - near)) * (1 - near / d);
    const width = 2 * 7 * Math.tan(THREE.MathUtils.degToRad(fov / 2));
    expect(spotPenumbra(near, far, fov, 1.25) * (depth(7) - depth(3))).toBeCloseTo((1.25 * 4) / 3 / width, 6);
  });

  it('offsets the shadow lookup of double-sided faces toward the viewer', () => {
    const vertex = THREE.ShaderChunk.shadowmap_vertex;
    const flip = vertex.indexOf(FACING_NORMAL_BIAS);
    expect(vertex.split(FACING_NORMAL_BIAS)).toHaveLength(2);
    // After the normal is set and before any light applies normalBias, for double-sided only.
    expect(flip).toBeGreaterThan(vertex.indexOf('vec4 shadowWorldPosition;'));
    expect(flip).toBeLessThan(vertex.indexOf('shadowNormalBias'));
    expect(vertex.lastIndexOf('#ifdef DOUBLE_SIDED', flip)).toBeGreaterThan(
      vertex.indexOf('vec4 shadowWorldPosition;'),
    );
  });
});
