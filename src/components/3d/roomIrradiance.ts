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
            return Math.abs(p.y - 0.1) < 0.002 && p.x >= -6.2 && p.x <= -0.5 && p.z >= -4.71 && p.z <= -0.29;
          if (p.x < -6.23 || p.x > -0.46 || p.z < -4.59 || p.z > -0.2 || p.y < 0.06 || p.y > 3.36) return false;
          if (plane === 1) return Math.abs(p.z + 4.5125) < 0.002;
          if (plane === 4) return Math.abs(p.x + 6.0925) < 0.002;
          if (plane === 5) return Math.abs(p.y - 3.285) < 0.002;
          return (
            p.x >= -6.02 &&
            p.x <= -1.18 &&
            (plane === 2
              ? Math.abs(p.y - 1.035) < 0.002 && p.z >= -4.12 && p.z <= -3.16
              : Math.abs(p.y - 0.565) < 0.002 && p.z >= -3.04 && p.z <= -2.5)
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
    const receiver = new THREE.Mesh(receiverGeometry, material);
    receiver.name = floor ? 'Sauna floor irradiance receiver' : 'Sauna cedar irradiance receiver';
    receiver.castShadow = mesh.castShadow;
    receiver.receiveShadow = mesh.receiveShadow;
    mesh.add(receiver);
    triangles += selected.length / 3;
  }
  return triangles;
}

const PARS = /* glsl */ `
#ifdef SUI_ROOM_IRRADIANCE
uniform highp sampler3D suiRoomIrradiance;
uniform vec4 suiRoomBounds[6];
uniform vec2 suiRoomResolution[6];
uniform float suiRoomLevels[6];
uniform vec2 suiRoomAtlasSize;
vec4 suiRoomCoordinates(vec3 P, vec3 N) {
  int plane = -1;
  vec2 point = P.xz;
  float facing = N.y;
  if (abs(P.y - suiRoomLevels[0]) < 0.008 && N.y > 0.9) plane = 0;
  else if (abs(P.z - suiRoomLevels[1]) < 0.008 && N.z > 0.9) { plane = 1; point = P.xy; facing = N.z; }
#ifdef SUI_ROOM_EXTENSION
  else if (abs(P.y - suiRoomLevels[2]) < 0.008 && N.y > 0.9) plane = 2;
  else if (abs(P.y - suiRoomLevels[3]) < 0.008 && N.y > 0.9) plane = 3;
  else if (abs(P.x - suiRoomLevels[4]) < 0.008 && N.x > 0.9) { plane = 4; point = P.zy; facing = N.x; }
  else if (abs(P.y - suiRoomLevels[5]) < 0.008 && N.y < -0.9) { plane = 5; facing = -N.y; }
#endif
  if (plane < 0) return vec4(0.0);
  vec4 bounds = suiRoomBounds[plane];
  vec2 q = (point - bounds.xy) / (bounds.zw - bounds.xy);
  vec2 edge = min(point - bounds.xy, bounds.zw - point);
  float coverage = smoothstep(0.0, 0.15, min(edge.x, edge.y));
  coverage *= smoothstep(0.9, 0.99, facing);
  // Daytime image agreement did not improve. Keep that lighting and blend in
  // the validated dusk/night correction with the existing lighting transition.
  coverage *= suiIrradianceEvening;
  if (coverage == 0.0) return vec4(0.0);
  vec2 uv = (clamp(q, 0.0, 1.0) * (suiRoomResolution[plane] - 1.0) + 0.5) / suiRoomAtlasSize;
  return vec4(uv, float(plane), coverage);
}
vec4 suiRoomDirectSample(vec3 P, vec3 N) {
  vec4 q = suiRoomCoordinates(P, N);
  if (q.w == 0.0) return vec4(0.0);
  return q.w * texture(suiRoomIrradiance, vec3(q.xy, (6.5 + q.z) / 12.0));
}
vec3 suiRoomLight(vec3 P, vec3 N, bool interior, bool underwater, vec3 direct) {
  vec4 q = suiRoomCoordinates(P, N);
  if (q.w == 0.0) return suiIrradiance(P, N, interior, underwater);
  // New receivers replace only direct light. Retain their existing directional
  // indirect probes; the original floor/wall keep their validated local bake.
  if (q.z >= 2.0) return suiIrradiance(P, N, interior, underwater) + direct;
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
  // RGB is premultiplied by sample validity. Fade invalid/embedded samples to
  // the existing probes instead of leaking light from inside a bench bearer.
  float remaining = 1.0 - coverage * valid;
  vec3 result = coverage * suiOvercastLight(fine, suiOvercast.y) + direct;
  // The fully covered interior needs only the local sample. Read the seven
  // coarse SH texels only at the fade/normal boundaries or an invalid sample.
  if (remaining > 0.0) result += remaining * suiIrradiance(P, N, interior, underwater);
  return max(result, vec3(0.0));
}
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
irradiance += suiRoomLight(suiWorldPosition, suiWorldNormal, suiInterior, suiUnderwater, suiRoomDirectLight.rgb);
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
