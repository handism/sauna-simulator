import * as THREE from 'three';

export interface WaterDefinition {
  center: number[];
  size: [number, number];
  inlet: number[];
  spout: number[];
}

// A bounded surface avoids rings crossing the pool coping. No fluid simulation.
// `sky` is the scene background color, which the lighting updates in place.
export function createWaterEffects(definition: WaterDefinition, sky: THREE.Color) {
  const group = new THREE.Group();
  const time = { value: 0 };
  const vertexShader = `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  // The source water is clear (transmission 1, IOR 1.333, absorption density 0.12), so the teal
  // tiles below stay visible. Only the Fresnel reflection of the untonemapped sky is blended over.
  const water = new THREE.ShaderMaterial({
    uniforms: { time, sky: { value: sky } },
    vertexShader: `varying vec2 vUv; varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `uniform float time; uniform vec3 sky; varying vec2 vUv; varying vec3 vWorld;
      void main() {
        vec2 offset = (vUv - vec2(0.5, 1.0)) * vec2(2.65, 3.17);
        float radius = length(offset);
        float ripple = pow(0.5 + 0.5 * sin(radius * 32.0 - time * 3.0), 10.0) * exp(-radius * 1.4);
        float drift = sin(vUv.x * 18.0 + vUv.y * 14.0 + time * 0.4) * 0.01;
        float facing = abs(normalize(cameraPosition - vWorld).y);
        // Schlick's approximation for water (F0 = 0.02).
        float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
        vec3 color = mix(sky, vec3(0.78, 0.86, 0.86), ripple * 0.6);
        gl_FragColor = vec4(color, clamp(fresnel + ripple * 0.14 + drift, 0.0, 1.0));
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(...definition.size), water);
  surface.rotation.x = -Math.PI / 2;
  surface.position.fromArray(definition.center);
  group.add(surface);
  const flow = new THREE.ShaderMaterial({
    uniforms: { time },
    vertexShader,
    fragmentShader: `uniform float time; varying vec2 vUv;
      void main() {
        float streak = 0.5 + 0.5 * sin(vUv.x * 110.0 + sin(vUv.y * 14.0 + time * 5.0));
        float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(0.0, 0.08, 1.0-vUv.x);
        gl_FragColor = vec4(vec3(0.62, 0.83, 0.84), (0.13 + streak * 0.15) * edge);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const height = definition.spout[1] - definition.inlet[1];
  const cascade = new THREE.Mesh(new THREE.PlaneGeometry(0.46, height), flow);
  cascade.position.fromArray(definition.inlet);
  cascade.position.y += height / 2;
  cascade.position.z += 0.015;
  group.add(cascade);
  return {
    group,
    update: (seconds: number, reducedMotion: boolean) => {
      time.value = reducedMotion ? 0 : seconds;
    },
  };
}
