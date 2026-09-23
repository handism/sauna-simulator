import * as THREE from 'three';

export interface WaterDefinition {
  center: number[];
  size: [number, number];
  inlet: number[];
  spout: number[];
}

// A bounded surface avoids rings crossing the pool coping. No fluid simulation.
export function createWaterEffects(definition: WaterDefinition) {
  const group = new THREE.Group();
  const time = { value: 0 };
  const vertexShader = `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const water = new THREE.ShaderMaterial({
    uniforms: { time },
    vertexShader,
    fragmentShader: `uniform float time; varying vec2 vUv;
      void main() {
        vec2 offset = (vUv - vec2(0.5, 1.0)) * vec2(2.65, 3.17);
        float radius = length(offset);
        float ripple = pow(0.5 + 0.5 * sin(radius * 32.0 - time * 3.0), 10.0);
        float fade = exp(-radius * 1.4);
        float drift = sin(vUv.x * 18.0 + vUv.y * 14.0 + time * 0.4) * 0.025;
        vec3 color = vec3(0.08, 0.31, 0.29) + vec3(0.32, 0.46, 0.44) * ripple * fade + drift;
        gl_FragColor = vec4(color, 0.38 + ripple * fade * 0.18);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
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
