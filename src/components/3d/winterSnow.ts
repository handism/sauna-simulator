import * as THREE from 'three';

// Restrict the treatment to existing outdoor surfaces, timber and the garden accents' shrubs
// (which stood bright green on the white ground otherwise). The timber
// shader excludes the sheltered room/terrace by position; water, glass, towels,
// lamps and pool tiles never receive the extension.
export function receivesWinterSnow(name: string) {
  return /moss|woodland earth|garden gravel|tree bark|mineral charcoal stone|pale mineral paving|quiet honed stone|outdoor ash|warm open-grain timber|garden evergreen foliage/i.test(
    name,
  );
}

export function patchWinterSnowShader(shader: { vertexShader: string; fragmentShader: string }) {
  const common = '#include <common>';
  const project = '#include <project_vertex>';
  const roughness = '#include <roughnessmap_fragment>';
  if (
    !shader.vertexShader.includes(project) ||
    !shader.vertexShader.includes(common) ||
    !shader.fragmentShader.includes(roughness) ||
    !shader.fragmentShader.includes(common)
  )
    throw Error('Unsupported three.js shader chunks for winter snow');
  shader.vertexShader = shader.vertexShader
    .replace(common, `${common}\nvarying vec3 vSuiSnowPosition;\nvarying vec3 vSuiSnowNormal;`)
    .replace(
      project,
      `${project}\nvSuiSnowPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSuiSnowNormal = inverseTransformDirection(transformedNormal, viewMatrix);`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      common,
      `${common}\nuniform float suiWinterSnow;\nvarying vec3 vSuiSnowPosition;\nvarying vec3 vSuiSnowNormal;`,
    )
    .replace(
      roughness,
      `${roughness}
      // Thin settled snow on upward surfaces, with a soft irregular boundary.
      vec3 suiSnowP = vSuiSnowPosition;
      float suiSnowUp = normalize(vSuiSnowNormal).y;
      #ifdef DOUBLE_SIDED
      suiSnowUp *= gl_FrontFacing ? 1.0 : -1.0;
      #endif
      float suiSnowGrain = sin(suiSnowP.x * 3.1 + sin(suiSnowP.z * 2.7)) * sin(suiSnowP.z * 4.3);
      float suiSnowCover = smoothstep(0.35, 0.78, suiSnowUp + suiSnowGrain * 0.07);
      // Preserve the sauna, pool and sheltered deck; their roof tops remain eligible.
      bool suiSheltered = suiSnowP.x > -7.1 && suiSnowP.x < 7.1 && suiSnowP.z > -5.3 && suiSnowP.z < 2.9 && suiSnowP.y < 3.35;
      suiSnowCover *= suiSheltered ? 0.0 : suiWinterSnow;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.83, 0.88), suiSnowCover);
      roughnessFactor = mix(roughnessFactor, 0.92, suiSnowCover);
    `,
    );
}

export function applyWinterSnow(material: THREE.MeshStandardMaterial, amount: { value: number }) {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.suiWinterSnow = amount;
    patchWinterSnowShader(shader);
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}|winter-snow`;
  material.needsUpdate = true;
}
