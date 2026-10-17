import * as THREE from 'three';
import { IRRADIANCE_LINE } from './irradiance';

export interface DeckIrradianceHeader {
  version: number;
  width: number;
  height: number;
  min: number[];
  max: number[];
  level: number;
  scenes: string[];
}

/** Separate only the top triangles before material preparation. The merged stone
 * also contains underwater faces; giving that material another sampler would
 * exceed the water shader's texture budget. Attributes remain shared. */
export function isolateDeckReceivers(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      object.material instanceof THREE.MeshStandardMaterial &&
      object.material.name === 'V2 | mineral charcoal stone' &&
      !object.material.userData.suiDeckReceiver
    )
      meshes.push(object);
  });
  const point = new THREE.Vector3();
  let triangles = 0;
  for (const mesh of meshes) {
    const source = mesh.geometry;
    const index = source.index;
    if (!index) throw Error('Expected indexed approach stones');
    const position = source.getAttribute('position');
    const kept: number[] = [],
      selected: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      const vertices = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      const top = vertices.every((v) => {
        point.fromBufferAttribute(position, v).applyMatrix4(mesh.matrixWorld);
        return (
          point.x >= -5.5 && point.x <= 5.5 && point.z >= 3.65 && point.z <= 4.55 && Math.abs(point.y - 0.065) < 0.008
        );
      });
      (top ? selected : kept).push(...vertices);
    }
    if (!selected.length) continue;
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
    geometry.setIndex(selected);
    source.setIndex(kept);
    const material = (mesh.material as THREE.MeshStandardMaterial).clone();
    material.userData.suiDeckReceiver = true;
    const receiver = new THREE.Mesh(geometry, material);
    receiver.name = 'Deck approach-stone tops';
    receiver.castShadow = mesh.castShadow;
    receiver.receiveShadow = mesh.receiveShadow;
    mesh.add(receiver);
    triangles += selected.length / 3;
  }
  return triangles;
}

// This is the full baked irradiance at the approach-stone tops, with browser-drawn
// direct lights excluded exactly as in the coarse probes. Replace, never add it.
const PARS = /* glsl */ `
#ifdef SUI_DECK_IRRADIANCE
uniform highp sampler3D suiDeckIrradiance;
uniform vec4 suiDeckBounds;
uniform vec2 suiDeckResolution;
uniform float suiDeckLevel;
vec3 suiDeckLight(vec3 coarse, vec3 P, vec3 N) {
  vec2 q = (P.xz - suiDeckBounds.xy) / (suiDeckBounds.zw - suiDeckBounds.xy);
  vec2 edge = min(q, 1.0 - q) * (suiDeckBounds.zw - suiDeckBounds.xy);
  float coverage = smoothstep(0.0, 0.15, min(edge.x, edge.y));
  coverage *= 1.0 - smoothstep(0.008, 0.025, abs(P.y - suiDeckLevel));
  coverage *= smoothstep(0.94, 0.99, N.y);
  if (coverage == 0.0 || suiIrradianceEvening == 0.0) return coarse;
  vec2 uv = (clamp(q, 0.0, 1.0) * (suiDeckResolution - 1.0) + 0.5) / suiDeckResolution;
  vec3 evening = texture(suiDeckIrradiance, vec3(uv, 0.25)).rgb;
  vec3 night = texture(suiDeckIrradiance, vec3(uv, 0.75)).rgb;
  vec3 fine = mix(evening * suiSeasonIrradiance[4], night * suiSeasonIrradiance[5], suiIrradianceNight / suiIrradianceEvening);
  // Remove only the dusk/night component already in the coarse grid; leave
  // the daytime contribution intact during automatic and manual transitions.
  // This small patch lies entirely inside the courtyard's unblended interior.
  vec3 lo = suiIrradianceMin[1], hi = suiIrradianceMax[1], res = suiIrradianceRes[1];
  vec3 q3 = clamp((P + N * 0.5 * (hi - lo) / (res - 1.0) - lo) / (hi - lo), 0.0, 1.0);
  vec3 uvw = (q3 * (res - 1.0) + 0.5) / res;
  float slices = res.z + 2.0, z = uvw.z * res.z + 1.0;
  vec3 bands = vec3(PI, 2.0 * PI / 3.0, PI / 4.0);
  vec3 old = vec3(0.0);
  float ew = suiIrradianceEvening - suiIrradianceNight;
  if (ew > 0.0) old += ew * suiEvaluateSH(suiProbeCourtyard, uvw.xy, z, 7.0, slices, N, bands) * suiSeasonIrradiance[4];
  if (suiIrradianceNight > 0.0) old += suiIrradianceNight * suiEvaluateSH(suiProbeCourtyard, uvw.xy, z, 14.0, slices, N, bands) * suiSeasonIrradiance[5];
  vec3 correction = suiOvercastLight(suiIrradianceEvening * fine - old, suiOvercast.x);
  return max(coarse + coverage * correction, vec3(0.0));
}
#endif
`;
if (!THREE.ShaderChunk.lights_pars_begin.includes('uniform highp sampler3D suiDeckIrradiance')) {
  if (!THREE.ShaderChunk.lights_fragment_begin.includes(IRRADIANCE_LINE))
    throw Error('Irradiance shader changed; update deckIrradiance.ts');
  THREE.ShaderChunk.lights_pars_begin += PARS;
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace(
    IRRADIANCE_LINE,
    `#ifdef SUI_DECK_IRRADIANCE
irradiance += suiDeckLight(suiIrradiance(suiWorldPosition, suiWorldNormal, suiInterior, suiUnderwater), suiWorldPosition, suiWorldNormal);
#else
${IRRADIANCE_LINE}
#endif`,
  );
}

export function createDeckIrradiance(header: DeckIrradianceHeader, buffer: ArrayBuffer) {
  if (
    header.version !== 1 ||
    !Number.isInteger(header.width) ||
    header.width < 2 ||
    header.width > 512 ||
    !Number.isInteger(header.height) ||
    header.height < 2 ||
    header.height > 512 ||
    header.scenes?.join() !== 'evening,night' ||
    header.min?.length !== 2 ||
    header.max?.length !== 2 ||
    ![...header.min, ...header.max, header.level].every(Number.isFinite) ||
    !header.min.every((v, i) => v < header.max[i]) ||
    buffer.byteLength !== header.width * header.height * 2 * 4 * 2
  )
    throw Error('deck irradiance');
  const data = new Uint16Array(buffer);
  if (data.some((v) => (v & 0x7c00) === 0x7c00 || (v & 0x8000) !== 0)) throw Error('deck irradiance values');
  const texture = new THREE.Data3DTexture(data, header.width, header.height, 2);
  texture.type = THREE.HalfFloatType;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  const uniforms = {
    suiDeckIrradiance: { value: texture },
    suiDeckBounds: { value: new THREE.Vector4(...header.min, ...header.max) },
    suiDeckResolution: { value: new THREE.Vector2(header.width, header.height) },
    suiDeckLevel: { value: header.level },
  };
  return {
    texture,
    apply(root: THREE.Object3D) {
      const materials = new Set<THREE.MeshStandardMaterial>();
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          if (
            material instanceof THREE.MeshStandardMaterial &&
            material.userData.suiDeckReceiver === true &&
            material.defines?.SUI_DECK_IRRADIANCE === undefined
          )
            materials.add(material);
      });
      for (const material of materials) {
        material.defines = { ...material.defines, SUI_DECK_IRRADIANCE: '' };
        const previous = material.onBeforeCompile;
        const previousKey = material.customProgramCacheKey;
        material.onBeforeCompile = (shader, renderer) => {
          previous.call(material, shader, renderer);
          Object.assign(shader.uniforms, uniforms);
        };
        material.customProgramCacheKey = () => `${previousKey.call(material)}|deck-irradiance-v1`;
        material.needsUpdate = true;
      }
      return materials.size;
    },
    dispose() {
      texture.dispose();
    },
  };
}
