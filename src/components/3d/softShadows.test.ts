import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BLOCKER_SAMPLES,
  FACING_NORMAL_BIAS,
  FILTER_SAMPLES,
  SHADOW_FACING,
  SUN_LITE_BELOW,
  SUN_LITE_SAMPLES,
  directionalPenumbra,
  spotPenumbra,
} from './softShadows';

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

  it('skips the lookup of pixels facing away and takes the derivatives before the branch', () => {
    const lights = THREE.ShaderChunk.lights_fragment_begin;
    expect(lights.startsWith(SHADOW_FACING)).toBe(true);
    // Clearcoat has its own normal, so only the other standard materials skip.
    expect(SHADOW_FACING).toContain('#if defined( STANDARD ) && ! defined( USE_CLEARCOAT )');
    expect(lights).not.toContain('( directLight.visible && receiveShadow ) ? getShadow(');
    for (const [map, coord, fn] of [
      ['spotShadowMap[ i ]', 'vSpotLightCoord[ i ]', 'getShadow( '],
      ['directionalShadowMap[ i ]', 'vDirectionalShadowCoord[ i ]', 'suiSunShadow( directLight.color, '],
    ]) {
      const call = lights.indexOf(`( directLight.visible && receiveShadow && SUI_SHADOW_FACING ) ? ${fn}${map}`);
      const slope = lights.indexOf(`suiShadowSlope( ${coord} );`);
      expect(call).toBeGreaterThan(0);
      expect(slope).toBeGreaterThan(0);
      // The slope call sits on the line before the branch, inside the same shadow #if.
      expect(lights.slice(slope, call)).not.toContain('#');
      expect(lights.slice(slope, call).split('\n')).toHaveLength(2);
    }
    const pars = THREE.ShaderChunk.shadowmap_pars_fragment;
    expect(pars).toContain('void suiShadowSlope( vec4 shadowCoord )');
    // three's own shadow code has no derivatives; the PCSS takes them only in suiShadowSlope().
    expect(pars.match(/dFdx\(/g)).toHaveLength(1);
    expect(pars.match(/dFdy\(/g)).toHaveLength(1);
  });

  it('filters the faint blue-hour sun with fewer samples and every other shadow with the full count', () => {
    const pars = THREE.ShaderChunk.shadowmap_pars_fragment;
    const lights = THREE.ShaderChunk.lights_fragment_begin;
    const [blocker, filter] = SUN_LITE_SAMPLES;
    expect(pars).toContain('float suiGetShadowSunLite( sampler2D shadowMap');
    expect(pars).toContain(`i < ${blocker}; i ++`);
    expect(pars).toContain(`lit / ${filter}.0`);
    // Chosen per light from its color × intensity: below the threshold the lite filter, else getShadow.
    expect(pars).toMatch(
      new RegExp(
        `max\\( sunColor\\.r, max\\( sunColor\\.g, sunColor\\.b \\) \\) < ${SUN_LITE_BELOW.toFixed(4)}\\s*\\? suiGetShadowSunLite\\([^;]*: getShadow\\(`,
      ),
    );
    // Only the directional (sun) lookup goes through the branch; the spot lights keep getShadow.
    expect(lights.match(/suiSunShadow\(/g)).toHaveLength(1);
    expect(lights).toContain('? getShadow( spotShadowMap[ i ]');
    expect(lights).not.toContain('getShadow( directionalShadowMap');
  });

  it('switches only at the end of the blend to evening, where the sun is faint', () => {
    // lighting.ts: the sun goes from 3.2 (day, #fff1d5) to 0.045 (blue hour, blue 1.0).
    const sunMax = (evening: number) => THREE.MathUtils.lerp(3.2, 0.045, evening);
    expect(sunMax(1)).toBeLessThan(SUN_LITE_BELOW);
    expect(sunMax(0.5)).toBeGreaterThan(SUN_LITE_BELOW);
    expect(sunMax(0.97)).toBeGreaterThan(SUN_LITE_BELOW);
  });
});
