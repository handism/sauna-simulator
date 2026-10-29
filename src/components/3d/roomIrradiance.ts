import * as THREE from 'three';
import { IRRADIANCE_LINE } from './irradiance';

interface Surface {
  name: string;
  min: number[];
  max: number[];
  level: number;
  normal: number[];
  width: number;
  height: number;
}
export interface RoomIrradianceHeader {
  version: number;
  width: number;
  height: number;
  scenes: string[];
  surfaces: Surface[];
}

/** Separate existing room receiver faces before shader preparation.
 * Attribute buffers stay shared. Other wood, especially underwater receivers,
 * must not acquire the additional sampler. No triangles are added or removed. */
export function isolateRoomReceivers(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      object.material instanceof THREE.MeshStandardMaterial &&
      !object.material.userData.suiRoomReceiver &&
      ['V2 | outdoor ash / grain & wear', 'V2 | warm open-grain timber'].includes(object.material.name)
    )
      meshes.push(object);
  });
  let triangles = 0;
  const p = new THREE.Vector3();
  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    if (!geometry.index) throw Error('Expected indexed sauna wood');
    const position = geometry.getAttribute('position');
    const floor = (mesh.material as THREE.Material).name === 'V2 | outdoor ash / grain & wear';
    const kept: number[] = [],
      selected: number[] = [];
    for (let i = 0; i < geometry.index.count; i += 3) {
      const vertices = [0, 1, 2].map((j) => geometry.index!.getX(i + j));
      // All three vertices must belong to the same receiver plane. A triangle
      // joining different room planes must keep the original material.
      const points = vertices.map((v) =>
        new THREE.Vector3().fromBufferAttribute(position, v).applyMatrix4(mesh.matrixWorld),
      );
      const receiver = (floor ? [0] : [1, 2, 3, 4, 5]).some((plane) =>
        points.every((p) => {
          if (plane === 0)
            return (
              p.x >= -6.2 &&
              p.x <= -0.5 &&
              p.z >= -4.71 &&
              p.z <= -0.29 &&
              ((p.y >= 0.065 && p.y <= 0.105) ||
                (p.x >= -6.02 &&
                  p.x <= -1.18 &&
                  ((p.y >= 0.7 && p.y <= 0.98 && p.z >= -4.23 && p.z <= -3.21) ||
                    (p.y >= 0.23 && p.y <= 0.51 && p.z >= -3.19 && p.z <= -2.55))))
            );
          if (p.x < -6.23 || p.x > -0.46 || p.z < -4.59 || p.z > -0.2 || p.y < 0.06 || p.y > 3.36) return false;
          if (plane === 1)
            return (
              Math.abs(p.z + 4.5145) < 0.004 ||
              (p.x >= -6.06 && p.x <= -1.14 && p.y >= 1.28 && p.y <= 1.94 && p.z >= -4.5 && p.z <= -4.35)
            );
          if (plane === 4) return Math.abs(p.x + 6.0945) < 0.004;
          if (plane === 5) return Math.abs(p.y - 3.2875) < 0.004;
          return (
            p.x >= -6.02 &&
            p.x <= -1.18 &&
            (plane === 2
              ? p.y >= 0.963 && p.y <= 1.037 && p.z >= -4.12 && p.z <= -3.16
              : p.y >= 0.493 && p.y <= 0.567 && p.z >= -3.04 && p.z <= -2.5)
          );
        }),
      );
      (receiver ? selected : kept).push(...vertices);
    }
    if (!selected.length) continue;
    const receiverGeometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(geometry.attributes)) receiverGeometry.setAttribute(name, attribute);
    receiverGeometry.setIndex(selected);
    // Shared attributes contain all the original wood. Bound only the selected
    // indices so a rear wall outside the view is actually culled.
    receiverGeometry.boundingBox = new THREE.Box3();
    for (const v of selected) receiverGeometry.boundingBox.expandByPoint(p.fromBufferAttribute(position, v));
    receiverGeometry.boundingSphere = receiverGeometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    geometry.setIndex(kept);
    const material = (mesh.material as THREE.MeshStandardMaterial).clone();
    material.userData.suiRoomReceiver = true;
    // Boards, seams and contact shadows on the floor (surfaceDetails.ts).
    if (floor) material.defines = { ...material.defines, SUI_ROOM_FLOOR: '' };
    const receiver = new THREE.Mesh(receiverGeometry, material);
    receiver.name = floor ? 'Sauna floor irradiance receiver' : 'Sauna cedar irradiance receiver';
    receiver.castShadow = mesh.castShadow;
    receiver.receiveShadow = mesh.receiveShadow;
    mesh.add(receiver);
    triangles += selected.length / 3;
  }
  return triangles;
}

/**
 * Not in the source: the heater's warmth on the room's floor, benches and walls. The ember glow
 * (surfaceDetails.ts HEATER_EMBER) lit only the stones, so by dusk and night the stove stood cold
 * in an evenly lit room. A point at the pile's hot core (`at`, world) gives `color` (linear, W/sr)
 * with cosine falloff over d² + `soft`; the cage's solid base hides it from the floor within
 * `shade` of the stove's axis. It is weak beside daylight and shows by dusk and night.
 */
export const STOVE_GLOW = { at: [-1.25, 0.62, -1.28], color: [1.3, 0.42, 0.1], soft: 0.04, shade: [0.42, 0.9] };
const f = (value: number) => value.toFixed(4);

const PARS = /* glsl */ `
#ifdef SUI_ROOM_IRRADIANCE
vec3 suiStoveGlow(vec3 P, vec3 N) {
  vec3 toStove = vec3(${STOVE_GLOW.at.map(f).join(', ')}) - P;
  float d2 = dot(toStove, toStove);
  float facing = max(dot(N, toStove * inversesqrt(max(d2, 1e-6))), 0.0);
  float base = smoothstep(${f(STOVE_GLOW.shade[0])}, ${f(STOVE_GLOW.shade[1])}, length(toStove.xz));
  return vec3(${STOVE_GLOW.color.map(f).join(', ')}) * facing * mix(base, 1.0, step(0.3, P.y)) / (d2 + ${f(STOVE_GLOW.soft)});
}
uniform highp sampler3D suiRoomIrradiance;
uniform vec4 suiRoomBounds[6];
uniform vec2 suiRoomResolution[6];
uniform float suiRoomLevels[6];
uniform vec2 suiRoomAtlasSize;
vec2 suiRoomUV(int plane, vec2 point) {
  vec4 bounds = suiRoomBounds[plane];
  vec2 q = clamp((point - bounds.xy) / (bounds.zw - bounds.xy), 0.0, 1.0);
  return (q * (suiRoomResolution[plane] - 1.0) + 0.5) / suiRoomAtlasSize;
}
#ifndef SUI_ROOM_EXTENSION
vec4 suiRoomCoordinates(vec3 P, vec3 N) {
  int plane = -1;
  vec2 point = P.xz;
  float facing = N.y;
  if (abs(P.y - suiRoomLevels[0]) < 0.008 && N.y > 0.9) plane = 0;
  else if (abs(P.z - suiRoomLevels[1]) < 0.008 && N.z > 0.9) { plane = 1; point = P.xy; facing = N.z; }
  if (plane < 0) return vec4(0.0);
  vec4 bounds = suiRoomBounds[plane];
  vec2 edge = min(point - bounds.xy, bounds.zw - point);
  float coverage = smoothstep(0.0, 0.15, min(edge.x, edge.y));
  coverage *= smoothstep(0.9, 0.99, facing) * suiIrradianceEvening;
  if (coverage == 0.0) return vec4(0.0);
  return vec4(suiRoomUV(plane, point), float(plane), coverage);
}
vec4 suiRoomDirectSample(vec3 P, vec3 N) {
  vec4 q = suiRoomCoordinates(P, N);
  if (q.w == 0.0) return vec4(0.0);
  return q.w * texture(suiRoomIrradiance, vec3(q.xy, (6.5 + q.z) / 12.0));
}
vec3 suiRoomLight(vec3 P, vec3 N, bool interior, bool underwater, vec3 direct) {
  vec4 q = suiRoomCoordinates(P, N);
  if (q.w == 0.0) return suiIrradiance(P, N, interior, underwater);
  int plane = int(q.z);
  float coverage = q.w;
  vec2 uv = q.xy;
  vec3 fine = vec3(0.0);
  float valid = 0.0;
  for (int scene = 0; scene < 3; scene++) {
    float weight = scene == 0 ? 1.0 - suiIrradianceEvening : (scene == 1 ? suiIrradianceEvening - suiIrradianceNight : suiIrradianceNight);
    if (weight > 0.0) {
      vec4 sampleValue = texture(suiRoomIrradiance, vec3(uv, (float(scene * 2 + plane) + 0.5) / 12.0));
      fine += weight * sampleValue.rgb * suiSeasonIrradiance[scene];
      valid += weight * sampleValue.a;
    }
  }
  float remaining = 1.0 - coverage * valid;
  vec3 result = coverage * suiOvercastLight(fine, suiOvercast.y) + direct;
  if (remaining > 0.0) result += remaining * suiIrradiance(P, N, interior, underwater);
  return max(result, vec3(0.0));
}
#else
float suiRoomRearWallY(float y) {
  if (y <= 1.31) return min(y, 1.225);
  if (y <= 1.61) return 1.475;
  if (y <= 1.84) return 1.725;
  return max(y, 1.975);
}
vec4 suiRoomDirectSample(vec3 P, vec3 N) {
  // Upper and lower bench slats: replace flat-top direct light, add warm gap fill on bevels/sides, occlude underside.
  if (P.x >= -6.02 && P.x <= -1.18) {
    int benchPlane = -1;
    if (abs(P.y - 1.00) < 0.038 && P.z >= -4.12 && P.z <= -3.16) benchPlane = 2;
    else if (abs(P.y - 0.53) < 0.038 && P.z >= -3.04 && P.z <= -2.50) benchPlane = 3;
    if (benchPlane >= 2) {
      vec2 uv = suiRoomUV(benchPlane, P.xz);
      vec3 direct = texture(suiRoomIrradiance, vec3(uv, (6.5 + float(benchPlane)) / 12.0)).rgb;
      float top = smoothstep(0.70, 0.96, N.y);
      // Warm fill only inside the gaps between slats, not on the open front nosing.
      float front = benchPlane == 2 ? smoothstep(-3.24, -3.19, P.z) : smoothstep(-2.58, -2.53, P.z);
      float sideFill = 0.18 * (1.0 - top) * (1.0 - front) * smoothstep(-0.35, 0.20, N.y);
      float underOcc = 0.65 * smoothstep(-0.20, -0.65, N.y);
      return vec4((top + sideFill) * direct, max(top, underOcc));
    }
    // Under-bench light-shielding lips and bearers: partially occluded by the bench overhang above.
    if ((P.y >= 0.70 && P.y <= 0.98 && P.z >= -4.23 && P.z <= -3.21) ||
        (P.y >= 0.23 && P.y <= 0.51 && P.z >= -3.19 && P.z <= -2.55)) {
      return vec4(0.0, 0.0, 0.0, N.z < -0.5 ? 0.0 : 0.32);
    }
  }
  // Left wall and ceiling planks + 4mm bevel grooves.
  if (abs(P.x - suiRoomLevels[4]) < 0.008 && N.x > 0.0) {
    vec2 uv = suiRoomUV(4, P.zy);
    vec3 direct = texture(suiRoomIrradiance, vec3(uv, 10.5 / 12.0)).rgb;
    return vec4(clamp(N.x, 0.0, 1.0) * direct, 1.0);
  }
  if (abs(P.y - suiRoomLevels[5]) < 0.008 && N.y < 0.0) {
    vec2 uv = suiRoomUV(5, P.xz);
    vec3 direct = texture(suiRoomIrradiance, vec3(uv, 11.5 / 12.0)).rgb;
    return vec4(clamp(-N.y, 0.0, 1.0) * direct, 1.0);
  }
  // Floor planks + 4mm bevels across full room floor (including right glass edge and front floor).
  if (abs(P.y - 0.085) < 0.025 && N.y > 0.0) {
    vec2 uv = suiRoomUV(0, P.xz);
    vec4 s = texture(suiRoomIrradiance, vec3(uv, 6.5 / 12.0));
    float underBench = smoothstep(-2.38, -2.58, P.z);
    float facing = clamp(N.y, 0.0, 1.0);
    return vec4(underBench * facing * s.rgb, mix(0.28, s.a, underBench));
  }
  // Rear wall planks + 4mm grooves, and Cedar backrest slats/posts.
  if (abs(P.z - suiRoomLevels[1]) < 0.008 && N.z > 0.0) {
    float slot = smoothstep(1.43, 1.47, P.y) * smoothstep(1.60, 1.53, P.y) * step(P.x, -1.14) * step(-6.06, P.x);
    float yDirect = P.y > 0.98 && P.y < 1.24 ? mix(P.y, 1.04, smoothstep(1.25, 1.15, P.y)) : suiRoomRearWallY(P.y);
    vec2 uv = suiRoomUV(1, vec2(P.x, yDirect));
    vec4 s = texture(suiRoomIrradiance, vec3(uv, 7.5 / 12.0));
    // Above the baked range (y <= 2.6m) fall back to the original six-light direct term.
    float highFade = smoothstep(2.62, 2.45, P.y);
    float benchBounce = 1.0 + 0.32 * smoothstep(0.75, 1.00, P.y) * smoothstep(1.25, 1.10, P.y);
    float keep = (1.0 - slot) * highFade;
    return vec4(keep * clamp(N.z, 0.0, 1.0) * benchBounce * s.rgb, keep * s.a);
  }
  if (P.x >= -6.06 && P.x <= -1.14 && P.y >= 1.28 && P.y <= 1.94 && P.z >= -4.505 && P.z <= -4.35 && N.z > 0.0) {
    vec2 uv = suiRoomUV(1, vec2(P.x, 2.10));
    vec3 direct = texture(suiRoomIrradiance, vec3(uv, 7.5 / 12.0)).rgb;
    return vec4(0.24 * clamp(N.z, 0.0, 1.0) * direct, 0.0);
  }
  return vec4(0.0);
}
vec3 suiRoomSampleIndirect(int plane, vec2 uv, out float valid) {
  vec3 fine = vec3(0.0);
  valid = 0.0;
  for (int scene = 0; scene < 3; scene++) {
    float weight = scene == 0 ? 1.0 - suiIrradianceEvening : (scene == 1 ? suiIrradianceEvening - suiIrradianceNight : suiIrradianceNight);
    if (weight > 0.0) {
      vec4 sampleValue = texture(suiRoomIrradiance, vec3(uv, (float(scene * 2 + plane) + 0.5) / 12.0));
      fine += weight * sampleValue.rgb * suiSeasonIrradiance[scene];
      valid += weight * sampleValue.a;
    }
  }
  return suiOvercastLight(fine, suiOvercast.y);
}
vec3 suiRoomLight(vec3 P, vec3 N, bool interior, bool underwater, vec3 direct) {
  // Floor planks + bevels.
  if (abs(P.y - 0.085) < 0.025 && N.y > 0.0) {
    float underBench = smoothstep(-2.38, -2.58, P.z);
    if (underBench > 0.0) {
      float valid;
      vec3 fine = suiRoomSampleIndirect(0, suiRoomUV(0, P.xz), valid);
      float w = underBench * valid;
      float facing = clamp(N.y, 0.0, 1.0);
      vec3 result = w * facing * fine + direct;
      if (w < 1.0) result += (1.0 - w) * facing * suiIrradiance(P, N, interior, underwater);
      return max(result, vec3(0.0));
    }
    return max(clamp(N.y, 0.0, 1.0) * suiIrradiance(P, N, interior, underwater) + direct, vec3(0.0));
  }
  // Rear wall planks + 4mm grooves.
  if (abs(P.z - suiRoomLevels[1]) < 0.008 && N.z > 0.0) {
    float valid;
    vec3 fine = suiRoomSampleIndirect(1, suiRoomUV(1, vec2(P.x, suiRoomRearWallY(P.y))), valid);
    float highWeight = smoothstep(2.62, 2.45, P.y) * valid;
    float facing = clamp(N.z, 0.0, 1.0);
    vec3 result = highWeight * facing * fine + direct;
    if (highWeight < 1.0) result += (1.0 - highWeight) * facing * suiIrradiance(P, N, interior, underwater);
    return max(result, vec3(0.0));
  }
  // Left wall and ceiling planks + 4mm grooves: attenuate indirect inside recessed grooves.
  if (abs(P.x - suiRoomLevels[4]) < 0.008 && N.x > 0.0) {
    return max(clamp(N.x, 0.25, 1.0) * suiIrradiance(P, N, interior, underwater) + direct, vec3(0.0));
  }
  if (abs(P.y - suiRoomLevels[5]) < 0.008 && N.y < 0.0) {
    return max(clamp(-N.y, 0.25, 1.0) * suiIrradiance(P, N, interior, underwater) + direct, vec3(0.0));
  }
  return max(suiIrradiance(P, N, interior, underwater) + direct, vec3(0.0));
}
#endif
#endif
`;
if (!THREE.ShaderChunk.lights_pars_begin.includes('uniform highp sampler3D suiRoomIrradiance')) {
  if (!THREE.ShaderChunk.lights_fragment_begin.includes(IRRADIANCE_LINE)) throw Error('Room irradiance shader changed');
  const rect =
    'reflectedLight.directDiffuse += rectAreaLight.color * material.diffuseContribution * suiRectFormFactor( geometryNormal, geometryPosition, rectCoords );';
  if (
    !THREE.ShaderChunk.lights_fragment_begin.includes(rect) ||
    !THREE.ShaderChunk.lights_fragment_begin.includes('IncidentLight directLight;')
  )
    throw Error('Room direct-light shader changed');
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin
    .replace(
      'IncidentLight directLight;',
      `#ifdef SUI_ROOM_IRRADIANCE
vec4 suiRoomDirectLight = suiRoomDirectSample(suiWorldPosition, transformNormalByInverseViewMatrix(geometryNormal, viewMatrix));
#endif
IncidentLight directLight;`,
    )
    .replace(
      'if ( suiInterior ) {',
      `#ifdef SUI_ROOM_IRRADIANCE
if (suiInterior && suiRoomDirectLight.a < 1.0) {
#else
if ( suiInterior ) {
#endif`,
    )
    .replace(
      rect,
      `#ifdef SUI_ROOM_IRRADIANCE
reflectedLight.directDiffuse += (1.0 - suiRoomDirectLight.a) * rectAreaLight.color * material.diffuseContribution * suiRectFormFactor( geometryNormal, geometryPosition, rectCoords );
#else
${rect}
#endif`,
    );
  THREE.ShaderChunk.lights_pars_begin += PARS;
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace(
    IRRADIANCE_LINE,
    `#ifdef SUI_ROOM_IRRADIANCE
irradiance += suiRoomLight(suiWorldPosition, suiWorldNormal, suiInterior, suiUnderwater, suiRoomDirectLight.rgb)
  + suiStoveGlow(suiWorldPosition, suiWorldNormal);
#else
${IRRADIANCE_LINE}
#endif`,
  );
}

export function createRoomIrradiance(header: RoomIrradianceHeader, buffer: ArrayBuffer) {
  if (
    header.version !== 3 ||
    header.scenes?.join() !== 'day,evening,night' ||
    !Number.isInteger(header.width) ||
    header.width < 2 ||
    header.width > 512 ||
    !Number.isInteger(header.height) ||
    header.height < 2 ||
    header.height > 512 ||
    header.surfaces?.length !== 6 ||
    !header.surfaces.every(
      (p, i) =>
        p.name === ['floor', 'rear-wall', 'upper-bench', 'lower-bench', 'left-wall', 'ceiling'][i] &&
        p.min?.length === 2 &&
        p.max?.length === 2 &&
        p.normal?.join() === ['0,1,0', '0,0,1', '0,1,0', '0,1,0', '1,0,0', '0,-1,0'][i] &&
        [...p.min, ...p.max, p.level].every(Number.isFinite) &&
        p.min.every((v, j) => v < p.max[j]) &&
        Number.isInteger(p.width) &&
        p.width >= 2 &&
        p.width <= header.width &&
        Number.isInteger(p.height) &&
        p.height >= 2 &&
        p.height <= header.height,
    ) ||
    buffer.byteLength !== header.width * header.height * 12 * 8
  )
    throw Error('room irradiance');
  const data = new Uint16Array(buffer);
  if (data.some((v) => (v & 0x7c00) === 0x7c00 || (v & 0x8000) !== 0) || data.some((v, i) => i % 4 === 3 && v > 0x3c00))
    throw Error('room irradiance values');
  const pairSize = header.width * header.height * 2 * 4;
  for (let i = 3; i < pairSize; i += 4)
    if ([1, 2, 3].some((layer) => data[layer * pairSize + i] !== data[i])) throw Error('room irradiance validity');
  const texture = new THREE.Data3DTexture(data, header.width, header.height, 12);
  texture.type = THREE.HalfFloatType;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  const uniforms = {
    suiRoomIrradiance: { value: texture },
    suiRoomBounds: { value: header.surfaces.map((p) => new THREE.Vector4(...p.min, ...p.max)) },
    suiRoomResolution: { value: header.surfaces.map((p) => new THREE.Vector2(p.width, p.height)) },
    suiRoomLevels: { value: header.surfaces.map((p) => p.level) },
    suiRoomAtlasSize: { value: new THREE.Vector2(header.width, header.height) },
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
            material.userData.suiRoomReceiver === true &&
            material.defines?.SUI_ROOM_IRRADIANCE === undefined
          )
            materials.add(material);
      });
      for (const material of materials) {
        material.defines = { ...material.defines, SUI_ROOM_IRRADIANCE: '', SUI_ROOM_EXTENSION: '' };
        const previous = material.onBeforeCompile,
          previousKey = material.customProgramCacheKey;
        material.onBeforeCompile = (shader, renderer) => {
          previous.call(material, shader, renderer);
          Object.assign(shader.uniforms, uniforms);
        };
        material.customProgramCacheKey = () => `${previousKey.call(material)}|room-irradiance-v3`;
        material.needsUpdate = true;
      }
      return materials.size;
    },
    dispose() {
      texture.dispose();
    },
  };
}
