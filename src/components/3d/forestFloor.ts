import * as THREE from 'three';
import { surfaceDetailOf } from './surfaceDetails';

// The woodland stood on the same sunlit meadow as the open garden: nothing on the ground showed
// where the crowns were, so the trees read as set on the grass rather than growing from it, and
// the meadow ran unbroken under the tree line. The moss terrain under each woodland crown turns to
// a darker, browner forest floor (thin grass, litter and the canopy's lasting shade), broken into
// patches so it does not draw the crowns' outlines. A top-down map of the crowns' footprints, filled
// in once the garden arrives (crownNormals.ts measures the crowns), drives it; the materials get an
// empty map with the body so the garden needs no new program. Not a cast shadow (the sun's shadow
// map covers ±30m and the probes are baked without the garden): an albedo change under every light.

/** Half the side of the square the map covers, centered on the origin (m), and its texels per side. */
export const FLOOR_EXTENT = 50;
export const FLOOR_SIZE = 128;
/** A crown's footprint reaches this far past its measured extent, and covers at most this much. */
const FOOTPRINT_SCALE = 1.6;
const FOOTPRINT_COVER = 0.85;

/** A woodland crown seen from above: its center and half extents across the ground (m). */
export interface CrownFootprint {
  x: number;
  z: number;
  rx: number;
  rz: number;
}

/** The share of the ground each texel's crowns shade, 0–255, rows along +z. */
export function canopyCoverage(crowns: CrownFootprint[], size = FLOOR_SIZE, extent = FLOOR_EXTENT) {
  const open = new Float32Array(size * size).fill(1);
  const texel = (2 * extent) / size;
  for (const crown of crowns) {
    const rx = crown.rx * FOOTPRINT_SCALE;
    const rz = crown.rz * FOOTPRINT_SCALE;
    const i0 = Math.max(0, Math.floor((crown.x - rx + extent) / texel));
    const i1 = Math.min(size - 1, Math.ceil((crown.x + rx + extent) / texel));
    const j0 = Math.max(0, Math.floor((crown.z - rz + extent) / texel));
    const j1 = Math.min(size - 1, Math.ceil((crown.z + rz + extent) / texel));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const dx = ((i + 0.5) * texel - extent - crown.x) / rx;
        const dz = ((j + 0.5) * texel - extent - crown.z) / rz;
        const d = Math.hypot(dx, dz);
        if (d >= 1) continue;
        // Full under the inner half of the footprint, easing out to its rim.
        const t = Math.min(1, Math.max(0, (d - 0.5) / 0.5));
        open[j * size + i] *= 1 - FOOTPRINT_COVER * (1 - t * t * (3 - 2 * t));
      }
  }
  return Uint8Array.from(open, (value) => Math.round((1 - value) * 255));
}

const ROUGHNESS = '#include <roughnessmap_fragment>';

// Runs after the surface details' ground tint (it reads the position and the patch noise), before
// the autumn leaves (which lie on the forest floor too) and the snow.
const FLOOR = /* glsl */ `
  float suiCanopy = texture2D(suiCanopyMap, suiSurfaceP.xz / ${(2 * FLOOR_EXTENT).toFixed(1)} + 0.5).r;
  float suiDapple = suiSurfaceFilteredNoise(vec3(suiSurfaceP.xz * 0.8, 4.2));
  float suiFloor = clamp(suiCanopy * (0.7 + 0.6 * suiDapple), 0.0, 1.0);
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.42, 0.38, 0.3), suiFloor);
  suiSurfaceRoughness += suiFloor * 0.04;
`;

export function patchForestFloorShader(shader: { fragmentShader: string }) {
  if (!shader.fragmentShader.includes(ROUGHNESS) || !shader.fragmentShader.includes('float suiDry'))
    throw Error('The forest floor needs the surface details ground shader');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform sampler2D suiCanopyMap;')
    .replace(ROUGHNESS, `${FLOOR}\n${ROUGHNESS}`);
}

export function createForestFloor() {
  const data = new Uint8Array(FLOOR_SIZE * FLOOR_SIZE);
  const texture = new THREE.DataTexture(data, FLOOR_SIZE, FLOOR_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const map = { value: texture };
  const patched = new Set<THREE.Material>();
  return {
    texture,
    /** Gives the ground materials under `root` the (still empty) map; returns how many. Before the seasons. */
    apply(root: THREE.Object3D) {
      let count = 0;
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (!(material instanceof THREE.MeshStandardMaterial) || surfaceDetailOf(material.name) !== 'ground')
            continue;
          if (patched.has(material)) continue;
          patched.add(material);
          const previous = material.onBeforeCompile;
          const previousKey = material.customProgramCacheKey;
          material.onBeforeCompile = (shader, renderer) => {
            previous.call(material, shader, renderer);
            shader.uniforms.suiCanopyMap = map;
            patchForestFloorShader(shader);
          };
          material.customProgramCacheKey = () => `${previousKey.call(material)}|forest-floor-v1`;
          material.needsUpdate = true;
          count++;
        }
      });
      return count;
    },
    /** Fills the map from the woodland's crowns; only the texture is uploaded again. */
    update(crowns: CrownFootprint[]) {
      data.set(canopyCoverage(crowns));
      texture.needsUpdate = true;
    },
    dispose() {
      texture.dispose();
    },
  };
}
