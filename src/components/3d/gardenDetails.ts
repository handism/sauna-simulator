import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Season } from './season';

/** Browser-built garden accents. Geometry is deterministic and owned by the scene. */
export function addGardenDetails(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const terrain: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.every((material) => /moss|woodland earth|garden gravel/i.test(material.name))) terrain.push(object);
    }
  });
  // An incomplete or substitute model must not receive floating decorations.
  if (!terrain.length) return { finishPreparation() {}, update() {} };
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  const floor = (x: number, z: number) => {
    ray.ray.origin.set(x, 25, z);
    return ray.intersectObjects(terrain, false)[0]?.point.y ?? 0;
  };
  const group = new THREE.Group();
  group.name = 'Living garden';
  group.applyMatrix4(root.matrixWorld.clone().invert());
  root.add(group);
  const material = (name: string, color: number) => {
    const value = new THREE.MeshStandardMaterial({ color, roughness: 0.92 });
    value.name = name;
    return value;
  };
  const stone = material('Garden mineral charcoal stone', 0x777c70);
  const shrub = material('Garden evergreen foliage', 0x58713c);
  const grass = material('Garden meadow foliage', 0x819455);
  grass.side = THREE.DoubleSide;
  const flower = material('Garden seasonal flowers', 0xd7bd82);
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const add = (
    geometry: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = 1,
    sz = 1,
  ) => {
    geometry.scale(sx, sy, sz);
    geometry.translate(x, y, z);
    const list = batches.get(mat) ?? [];
    if (geometry.index) {
      const expanded = geometry.toNonIndexed();
      geometry.dispose();
      geometry = expanded;
    }
    list.push(geometry);
    batches.set(mat, list);
  };
  const patches = [
    [-4.8, 4.8],
    [-2.9, 7.2],
    [-0.5, 5.7],
    [3.8, 6.3],
    [6.4, 4.8],
    [7.6, 9.5],
    [-5.8, 11],
    [1.1, 12.5],
  ];
  for (const [index, [x, z]] of patches.entries()) {
    for (let n = 0; n < 7; n++) {
      const angle = n * 2.4 + index;
      const px = x + Math.cos(angle) * (0.25 + n * 0.15);
      const pz = z + Math.sin(angle) * (0.25 + n * 0.12);
      const y = floor(px, pz);
      const size = 0.28 + (n % 3) * 0.09;
      for (let leaf = 0; leaf < 54; leaf++) {
        const a = leaf * 2.399;
        const rise = (leaf + 0.5) / 54;
        const reach = Math.sqrt(1 - rise * rise) * size;
        const geometry = new THREE.IcosahedronGeometry(1, 0);
        geometry.scale(0.12, 0.028, 0.065);
        geometry.rotateZ(Math.sin(a) * 0.4);
        geometry.rotateY(a);
        add(geometry, shrub, px + Math.cos(a) * reach * 1.4, y + 0.1 + rise * size * 1.6, pz + Math.sin(a) * reach);
      }
      if (n % 2 === 0) add(new THREE.IcosahedronGeometry(1, 1), stone, px + 0.3, y + 0.12, pz + 0.25, 0.3, 0.22, 0.25);
      for (let f = 0; f < 4; f++) {
        add(
          new THREE.IcosahedronGeometry(1, 0),
          flower,
          px + Math.cos(f * 2.4) * 0.2,
          y + size * 1.55,
          pz + Math.sin(f * 2.4) * 0.2,
          0.07,
          0.045,
          0.07,
        );
      }
    }
  }
  // A shallow, stone-lined runnel alongside the path. Each ribbon section follows the terrain.
  const streamPositions: number[] = [];
  for (let i = 0; i < 38; i++) {
    const z = 4.7 + i * 0.23;
    const x = 1.65 + Math.sin(i * 0.12) * 0.65;
    const nz = z + 0.23;
    const nx = 1.65 + Math.sin((i + 1) * 0.12) * 0.65;
    const y = floor(x, z) + 0.105;
    const ny = floor(nx, nz) + 0.105;
    streamPositions.push(
      x - 0.27,
      y,
      z,
      nx - 0.27,
      ny,
      nz,
      x + 0.27,
      y,
      z,
      x + 0.27,
      y,
      z,
      nx - 0.27,
      ny,
      nz,
      nx + 0.27,
      ny,
      nz,
    );
    for (const side of [-1, 1]) {
      const bx = x + side * (0.36 + 0.04 * Math.sin(i * 3));
      add(new THREE.IcosahedronGeometry(1, 1), stone, bx, floor(bx, z) + 0.09, z, 0.2 + (i % 3) * 0.025, 0.16, 0.19);
    }
  }
  const streamGeometry = new THREE.BufferGeometry();
  streamGeometry.setAttribute('position', new THREE.Float32BufferAttribute(streamPositions, 3));
  streamGeometry.computeVertexNormals();
  const streamMaterial = material('Garden flowing water', 0x718c87);
  streamMaterial.roughness = 0.25;
  streamMaterial.metalness = 0.2;
  streamMaterial.side = THREE.DoubleSide;
  const clock = { value: 0 };
  streamMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.gardenTime = clock;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 gardenPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ngardenPosition = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 gardenPosition; uniform float gardenTime;')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nfloat ripple = sin(gardenPosition.z * 36.0 - gardenTime * 2.8 + sin(gardenPosition.x * 24.0)); diffuseColor.rgb *= 0.9 + 0.1 * ripple;',
      );
  };
  streamMaterial.customProgramCacheKey = () => 'garden-runnel-v1';
  const stream = new THREE.Mesh(streamGeometry, streamMaterial);
  group.add(stream);
  // Low hills around the woodland, with three overlapping silhouettes and atmospheric color.
  const hills: THREE.Mesh[] = [];
  const hazeColor = { value: new THREE.Color() };
  for (let layer = 0; layer < 3; layer++) {
    const positions: number[] = [];
    const colors: number[] = [];
    const radius = 72 + layer * 38;
    const segments = 320;
    const point = (j: number, row: number) => {
      const a = (j / segments) * Math.PI * 2;
      const height =
        7 +
        layer * 4 +
        3 * Math.sin(a * 3 + layer) +
        1.8 * Math.sin(a * 7 + 0.7 + layer) +
        0.65 * Math.sin(a * 19 + layer * 2) +
        0.3 * Math.sin(a * 43);
      const y = row === 0 ? -7 : row === 1 ? height * 0.38 : height;
      return [Math.cos(a) * radius, y, Math.sin(a) * radius];
    };
    const vertex = (j: number, row: number) => {
      positions.push(...point(j, row));
      const a = (j / segments) * Math.PI * 2;
      const shade = 0.76 + 0.08 * Math.sin(a * 11 + layer) + 0.04 * Math.sin(a * 29);
      const tint = new THREE.Color().setRGB(shade, shade, shade);
      // Neutral ridge variation; atmospheric color is blended after the surface tint.
      colors.push(tint.r, tint.g, tint.b);
    };
    for (let n = 0; n < segments; n++)
      for (let row = 0; row < 2; row++) {
        vertex(n, row);
        vertex(n, row + 1);
        vertex(n + 1, row + 1);
        vertex(n, row);
        vertex(n + 1, row + 1);
        vertex(n + 1, row);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.name = `Garden distant ridge ${layer}`;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.gardenHazeColor = hazeColor;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float gardenRidgeHeight;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ngardenRidgeHeight = position.y;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying float gardenRidgeHeight; uniform vec3 gardenHazeColor;',
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float valleyMist = 1.0 - smoothstep(-3.0, ${(12 + layer * 4).toFixed(1)}, gardenRidgeHeight);
          float haze = ${(0.24 + layer * 0.19).toFixed(2)} + valleyMist * 0.25;
          diffuseColor.rgb = mix(diffuseColor.rgb, gardenHazeColor, haze);`,
        );
    };
    mat.customProgramCacheKey = () => `garden-ridge-haze-${layer}`;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = mat.name;
    hills.push(mesh);
    group.add(mesh);
  }
  const movingGrass: THREE.Mesh[] = [];
  for (const [index, [x, z]] of patches.entries()) {
    const positions: number[] = [];
    for (let blade = 0; blade < 32; blade++) {
      const a = blade * 2.4;
      const r = 0.08 + (blade % 7) * 0.075;
      const px = Math.cos(a) * r,
        pz = Math.sin(a) * r;
      const height = 0.35 + (blade % 5) * 0.09;
      positions.push(px - 0.025, 0, pz, px + 0.025, 0, pz, px + Math.cos(a) * 0.2, height, pz + Math.sin(a) * 0.2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, grass);
    mesh.position.set(x + 0.9, floor(x + 0.9, z - 0.6), z - 0.6);
    mesh.name = `Garden grasses ${index}`;
    movingGrass.push(mesh);
    group.add(mesh);
  }
  const lamps: THREE.Mesh[] = [];
  const lampMaterial = material('Garden amber lantern', 0xf1c284);
  lampMaterial.emissive.setHex(0xffb75c);
  for (const [x, z] of [
    [-0.9, 4.7],
    [3.2, 7.9],
    [0.1, 10.7],
  ]) {
    const y = floor(x, z);
    add(new THREE.CylinderGeometry(0.13, 0.17, 0.48, 8), stone, x, y + 0.24, z);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.13, 8), lampMaterial);
    lamp.position.set(x, y + 0.48, z);
    lamps.push(lamp);
    group.add(lamp);
    add(new THREE.ConeGeometry(0.24, 0.13, 8), stone, x, y + 0.6, z);
  }
  const flowers: THREE.Mesh[] = [];
  for (const [mat, geometries] of batches) {
    const merged = mergeGeometries(geometries);
    for (const geometry of geometries) geometry.dispose();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = mat.name;
    if (mat === flower) flowers.push(mesh);
    group.add(mesh);
  }
  const butterflies: THREE.Group[] = [];
  const wingMaterial = new THREE.MeshStandardMaterial({ color: 0xf0d9a2, roughness: 0.9, side: THREE.DoubleSide });
  const wingGeometry = new THREE.CircleGeometry(0.09, 5);
  wingGeometry.rotateX(-Math.PI / 2);
  wingGeometry.translate(0.075, 0, 0);
  for (let n = 0; n < 3; n++) {
    const butterfly = new THREE.Group();
    butterfly.name = `Garden butterfly ${n}`;
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(wingGeometry, wingMaterial);
      wing.scale.x = side;
      butterfly.add(wing);
    }
    butterflies.push(butterfly);
    group.add(butterfly);
  }
  const butterflyFloors = butterflies.map((_, i) => floor(patches[i + 2][0], patches[i + 2][1]));
  const hillDay = [new THREE.Color(0x718575), new THREE.Color(0x8b9c9b), new THREE.Color(0xa7b4bc)];
  const hillNight = new THREE.Color(0x101c29);
  const airDay = new THREE.Color(0xaebdcc);
  const airEvening = new THREE.Color(0x8d8f9f);
  const airNight = new THREE.Color(0x25344f);
  return {
    group,
    /** Call after the generic model preparation, which otherwise enables every shadow. */
    finishPreparation() {
      for (const mesh of [...hills, stream, ...movingGrass, ...lamps]) mesh.castShadow = false;
      for (const hill of hills) hill.receiveShadow = false;
      for (const butterfly of butterflies)
        butterfly.traverse((object) => {
          if (object instanceof THREE.Mesh) object.castShadow = false;
        });
    },
    update(seconds: number, season: Season, timeOfDay: number, weather: string, reducedMotion: boolean) {
      const time = reducedMotion ? 0 : seconds;
      clock.value = time;
      const evening = Math.min(1, timeOfDay);
      lampMaterial.emissiveIntensity = evening * 3;
      grass.color.setHex(season === 'autumn' ? 0xad955d : season === 'winter' ? 0x827c63 : 0x819455);
      flower.color.setHex(season === 'spring' ? 0xe8c6cd : season === 'autumn' ? 0xcba657 : 0xc8c1df);
      for (const mesh of flowers) mesh.visible = season !== 'winter';
      hazeColor.value.copy(airDay).lerp(airEvening, Math.min(1, timeOfDay));
      hazeColor.value.lerp(airNight, Math.max(0, Math.min(1, timeOfDay - 1)));
      hazeColor.value.multiplyScalar(weather === 'clear' ? 1 : 0.7);
      for (const [i, hill] of hills.entries())
        (hill.material as THREE.MeshBasicMaterial).color
          .copy(hillDay[i])
          .lerp(hillNight, Math.min(1, timeOfDay / 2))
          .multiplyScalar(weather === 'clear' ? 1 : 0.7);
      for (const [i, mesh] of movingGrass.entries())
        mesh.rotation.z = Math.sin(time * 0.8 + i * 1.7) * (reducedMotion ? 0 : 0.025);
      for (const [i, butterfly] of butterflies.entries()) {
        butterfly.visible =
          !reducedMotion &&
          weather === 'clear' &&
          (season === 'spring' || season === 'summer') &&
          timeOfDay < 0.6 &&
          (time + i * 13) % 42 < 24;
        const x = patches[i + 2][0] + Math.sin(time * 0.27 + i * 2) * 0.8;
        const z = patches[i + 2][1] + Math.cos(time * 0.21 + i) * 0.6;
        butterfly.position.set(x, butterflyFloors[i] + 0.95 + Math.sin(time * 0.7 + i) * 0.22, z);
        butterfly.rotation.y = time * 0.27 + i;
        butterfly.children.forEach((wing, j) => {
          wing.rotation.z = Math.sin(time * 13 + i) * 0.65 * (j ? 1 : -1);
        });
      }
    },
  };
}
