import * as THREE from 'three';

/** A narrow, gently meandering channel beside the path. Distance increases upstream. */
export function streamSection(distance: number) {
  return {
    x: 1.65 + Math.sin((distance / 0.23) * 0.12) * 0.65,
    z: 4.7 + distance,
    width: 0.29 + 0.035 * Math.sin(distance * 2.1) + 0.018 * Math.sin(distance * 5.3 + 1),
  };
}

/** Shallow bed, wet margins and moving surface normals in one opaque, terrain-following mesh.
 * The bed is a visual approximation, not transparent water or an excavated terrain channel.
 */
export function createGardenStream(floor: (x: number, z: number) => number) {
  const positions: number[] = [];
  const coordinates: number[] = [];
  const indices: number[] = [];
  const across = [-1.25, -1, -0.6, 0, 0.6, 1, 1.25];
  for (let i = 0; i <= 76; i++) {
    const distance = i * 0.115;
    const { x, z, width } = streamSection(distance);
    for (const side of across) {
      const px = x + side * width;
      // Stay above the unmodified terrain; the wet banks sit a little lower than the film.
      positions.push(px, floor(px, z) + (Math.abs(side) > 1 ? 0.012 : 0.035), z);
      coordinates.push(side, distance);
    }
    if (i === 76) continue;
    for (let j = 0; j < across.length - 1; j++) {
      const a = i * across.length + j;
      const b = a + across.length;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('streamCoordinate', new THREE.Float32BufferAttribute(coordinates, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const clock = { value: 0 };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0 });
  material.name = 'Garden flowing water';
  material.side = THREE.DoubleSide;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.gardenTime = clock;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 streamCoordinate; varying vec2 gardenStream;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ngardenStream = streamCoordinate;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 gardenStream; uniform float gardenTime;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float bank = smoothstep(0.82, 1.18, abs(gardenStream.x));
        vec2 bedPoint = vec2(gardenStream.x * 0.29, gardenStream.y);
        // Ripples move toward the deck (decreasing distance). Filter subpixel waves.
        float phase = bedPoint.y * 29.0 + gardenTime * 2.4 + sin(bedPoint.x * 23.0 + bedPoint.y * 3.0);
        float waveFilter = 1.0 - smoothstep(0.7, 2.5, fwidth(phase));
        float wave = sin(phase) * waveFilter;
        float crossWave = sin(bedPoint.y * 17.0 + bedPoint.x * 35.0 + gardenTime * 1.7);
        vec2 bedGrid = bedPoint * vec2(15.0, 12.0);
        vec2 cell = floor(bedGrid);
        float seed = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
        vec2 pebble = fract(bedGrid) - 0.5 + 0.16 * vec2(sin(seed * 21.0), cos(seed * 17.0));
        float rim = length(pebble * vec2(1.0, 1.2));
        float aa = max(fwidth(rim), 0.025);
        float pebbleMask = 1.0 - smoothstep(0.3 - aa, 0.42 + aa, rim);
        float bedFilter = 1.0 - smoothstep(0.4, 1.1, max(fwidth(bedGrid.x), fwidth(bedGrid.y)));
        pebbleMask = mix(0.5, pebbleMask, bedFilter);
        vec3 gravel = mix(vec3(0.035, 0.047, 0.038), vec3(0.17, 0.19, 0.14), pebbleMask * (0.65 + mix(0.5, seed, bedFilter) * 0.35));
        vec3 waterBed = mix(gravel, vec3(0.025, 0.085, 0.077), 0.42);
        waterBed *= 0.88 + 0.08 * wave + 0.04 * crossWave * waveFilter;
        vec3 wetBank = gravel * vec3(0.7, 0.68, 0.55);
        diffuseColor.rgb *= mix(waterBed, wetBank, bank);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.2, 0.92, bank);',
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        float surfaceHeight = (wave * 0.003 + crossWave * waveFilter * 0.0015) * (1.0 - bank);
        vec3 streamDx = dFdx(-vViewPosition), streamDy = dFdy(-vViewPosition);
        vec3 streamR1 = cross(streamDy, normal), streamR2 = cross(normal, streamDx);
        float streamDet = dot(streamDx, streamR1);
        vec3 streamGradient = dFdx(surfaceHeight) * streamR1 + dFdy(surfaceHeight) * streamR2;
        normal = normalize(max(abs(streamDet), 1e-8) * normal - sign(streamDet) * streamGradient);`,
      );
  };
  material.customProgramCacheKey = () => 'garden-runnel-v2';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = material.name;
  return { mesh, clock };
}
