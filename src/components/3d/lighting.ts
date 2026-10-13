import * as THREE from 'three';
import { directionalPenumbra, spotPenumbra } from './softShadows';
import { createInteriorLights } from './interiorLights';
import { createIrradianceUniforms } from './irradiance';
import { createSky } from './sky';

// The source sun (both scenes) is invisible to glossy rays: it lights the diffuse layer (still
// reduced by the specular Fresnel) but draws no highlights. Its browser specular doubled the
// sunlit deck of camera 07. The sun is the only directional light.
//
// No browser light reaches the plunge below the water (interiorLights.ts WATER_BOX) directly. In
// Cycles, shadow rays stop at the refractive surface; the sun is invisible to transmission rays,
// and V9 and the blue-hour accents reach the tiles only along refracted paths, which the water
// probes already hold (their panoramas look through the surface, where transmission visibility
// applies). On the pool floor waterBottom.ts adds back the highlights of V9 and the dusk fill
// (their probes leave them out). The sauna-room lights are evaluated inside the room only.
export const DIRECTIONAL_START = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
export const SPOT_START = '#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )';
export const DIRECT_CALL =
  'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
export const SUN_DIFFUSE_ONLY = 'reflectedLight.directSpecular = suiSpecularBeforeSun;';
export const DRY_ONLY = 'if ( ! suiUnderwater ) ';
const begin = THREE.ShaderChunk.lights_fragment_begin;
if (!begin.includes(SUN_DIFFUSE_ONLY)) {
  const call = (start: string) => {
    const at = begin.indexOf(start);
    const found = at < 0 ? -1 : begin.indexOf(DIRECT_CALL, at);
    // three 0.186 is pinned; a changed chunk fails loudly instead of giving the sun highlights.
    if (found < 0 || begin.indexOf('#pragma unroll_loop_end', at) < found)
      throw new Error('three lighting chunks changed; update lighting.ts');
    return found;
  };
  const spot = call(SPOT_START);
  const sun = call(DIRECTIONAL_START);
  if (spot > sun) throw new Error('three lighting chunks changed; update lighting.ts');
  THREE.ShaderChunk.lights_fragment_begin =
    begin.slice(0, spot) +
    DRY_ONLY +
    begin.slice(spot, sun) +
    `vec3 suiSpecularBeforeSun = reflectedLight.directSpecular;\n\t\t${DRY_ONLY}${DIRECT_CALL}\n\t\t${SUN_DIFFUSE_ONLY}` +
    begin.slice(sun + DIRECT_CALL.length);
}

// Every spot light here stands for a Lambertian disk of the source (P/π candela on the axis), so
// its falloff is the exact cosine: a linear ramp between the 90° cone and the axis (penumbra 1).
// three's smoothstep gave half the Cycles light 70–90° off the axis (the lawn and deck grazed by
// the maple uplight) and up to 1.25x within 45° (V9 on the plunge).
const SPOT_SMOOTHSTEP = 'return smoothstep( coneCosine, penumbraCosine, angleCosine );';
export const SPOT_COSINE = 'return saturate( ( angleCosine - coneCosine ) / ( penumbraCosine - coneCosine ) );';
const pars = THREE.ShaderChunk.lights_pars_begin;
if (!pars.includes(SPOT_COSINE)) {
  if (pars.split(SPOT_SMOOTHSTEP).length !== 2) throw new Error('three lighting chunks changed; update lighting.ts');
  THREE.ShaderChunk.lights_pars_begin = pars.replace(SPOT_SMOOTHSTEP, SPOT_COSINE);
}

// AgX view exposure (stops) of the source Daylight, Blue hour and Night scenes.
const EXPOSURE = [0.15, 0.55, 0.9];
export type LightingMode = 'auto' | 'day' | 'evening' | 'night';

// The time of day: 0 is the Daylight scene, 1 Blue hour and 2 Night; in between, the two
// neighbouring scenes blend. Automatic lighting follows the real time since entering: dusk at 15
// minutes and night at 30, each reached over the last 3 minutes of its 15, and the night stays
// (there is no morning scene to return through). Holding each scene keeps the costliest blend,
// between day and dusk (the day's sun shadows with the dusk lights and two probe sets), to 3 minutes.
export const AUTO_SECONDS_PER_SCENE = 15 * 60,
  AUTO_TRANSITION_SECONDS = 3 * 60;
export function timeOfDay(mode: LightingMode, elapsedSeconds: number): number {
  if (mode !== 'auto') return { day: 0, evening: 1, night: 2 }[mode];
  const scenes = Math.max(0, elapsedSeconds) / AUTO_SECONDS_PER_SCENE;
  const scene = Math.floor(scenes);
  const hold = 1 - AUTO_TRANSITION_SECONDS / AUTO_SECONDS_PER_SCENE;
  return Math.min(2, scene + THREE.MathUtils.clamp((scenes - scene - hold) / (1 - hold), 0, 1));
}

// The rain and the snow are not in the source scenes, and nothing is baked for them: an
// approximation over the time of day's lighting, one overcast for both. It puts out the sun (the moon at night) and the V9 sunlight patch, turns
// the sky to an overcast deck (sky.ts) and dims and greys the probes (irradiance.ts suiOvercast),
// then opens the exposure part of the way back. Per scene (Daylight, Blue hour, Night):
/** Outdoor probe scale: the day loses its sunlit bounce, the dusk and night little. */
export const RAIN_PROBES = [0.45, 0.8, 0.85];
/** Indoor probes keep more: the room's own lights fill them. */
export const RAIN_INDOOR = [0.7, 0.9, 0.95];
/** Share of the probes' color taken to grey. */
export const RAIN_DESATURATION = 0.55;
/**
 * The clear day the browser shows (not the source): the source Daylight's sun is soft against its
 * sky fill, so shadows and sunlit faces read flat, like a hazy day. With a clear sky (sky.ts
 * CLEAR_DAY_SKY) the sun and the V9 patch of sunlight are this much stronger, by the day's weight
 * and the share of clear weather; the exposure closes a little so sunlit faces keep their color.
 * The probes are unchanged, so the sun's share of the light rises.
 */
export const CLEAR_DAY_SUN = 2.2;
export const CLEAR_DAY_EXPOSURE = -0.1;

/**
 * Exposure added (stops) by day while snow lies on the ground (the winter season): an eye or camera
 * adapts to the bright field. At the day's exposure the snow sat on the tone curve's shoulder, a
 * flat white in which neither the ground's relief nor the drifts showed.
 */
export const SNOW_GROUND_EXPOSURE = -0.35;

/**
 * 'V10 path grazing light 1/4/7' (glTF axes): low 0.28m disks beside the stepping stones, shining
 * across them. Garden accents keep out of their beams (gardenDetails.ts).
 */
export const FOOTLIGHTS = [
  [-0.9754, -0.1338, 8.89],
  [-0.7056, -0.0702, 7.06],
  [-1.2998, -0.0486, 5.23],
] as const;
export const FOOTLIGHT_DIRECTION = [0.9661, -0.1255, -0.2258] as const;

/** Exposure added (stops), as an eye or camera adapts to the darker overcast. */
export const RAIN_EXPOSURE = [0.9, 0.3, 0.1];
/** Overcast sky radiance (linear) at its base; slightly blue grey. */
export const RAIN_SKY = [0.24, 0.06, 0.012];
const RAIN_SKY_TINT = [0.92, 0.97, 1.06];
/** Seconds of the exponential approach of the weather (and of the time of day). */
const SMOOTHING_SECONDS = 1.4;

/** Weights of the Daylight, Blue hour and Night scenes at a time of day (at most two are not 0). */
export function sceneWeights(time: number): [number, number, number] {
  const t = THREE.MathUtils.clamp(time, 0, 2);
  return [Math.max(0, 1 - t), 1 - Math.abs(t - 1), Math.max(0, t - 1)];
}

/**
 * three draws each shadow map into a render target with an RGBA8 color texture beside the depth
 * texture the shaders read (WebGLLights), 16 MB never read at 2048². three creates the target in
 * its first shadow pass (and again when the map is null), so the color is narrowed to R8 as the
 * target is set, before it is allocated.
 */
export function narrowShadowColor(shadow: THREE.LightShadow) {
  let map = shadow.map;
  Object.defineProperty(shadow, 'map', {
    configurable: true,
    enumerable: true,
    get: () => map,
    set(target: THREE.WebGLRenderTarget | null) {
      if (target) target.texture.format = THREE.RedFormat;
      map = target;
    },
  });
}

export function createLighting(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  // Cycles renders the courtyard without mist, so distant trees keep their color. The sky is the
  // source worlds' sky in scene-linear radiance (sky.ts), tone mapped with the rest of the scene.
  const sky = createSky();
  scene.add(sky.mesh);
  // Sky, the remaining Cycles area lights and all bounce light, baked per scene (irradiance.ts).
  const irradiance = createIrradianceUniforms();
  const sun = new THREE.DirectionalLight('#fff1d5', 5.5);
  // Covers the garden and the slope the Cycles cameras see; beyond it everything was sunlit.
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = 110;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.035;
  // Penumbra of the source sun's 0.085 rad disk and of the night's 0.0093 rad moon (softShadows.ts).
  const sunPenumbra = directionalPenumbra(sun.shadow.camera, 0.085),
    moonPenumbra = directionalPenumbra(sun.shadow.camera, 0.0093);
  sun.shadow.radius = sunPenumbra;
  sun.shadow.autoUpdate = false;
  // The sauna room's source area lights, confined to the room (see interiorLights.ts). They keep
  // the same power in every source scene.
  const interior = createInteriorLights();
  // Cycles 'V9 lounge patch of sunlight': a 950 W, 1.25 m disk above the lounge and plunge.
  // A Lambertian disk emits P/π candela on its axis with a cosine falloff (a 90° cone with full
  // penumbra, see SPOT_COSINE). Its shadow is static, so it renders once per shadow size.
  const lounge = new THREE.SpotLight(
    new THREE.Color().setRGB(1, 0.84, 0.62, THREE.LinearSRGBColorSpace),
    0,
    0,
    Math.PI / 2,
    1,
    2,
  );
  // A 180° shadow frustum is impossible; 144° covers the lit courtyard.
  lounge.shadow.focus = 0.8;
  lounge.position.set(3.8, 6.8, 1.5);
  lounge.target.position.set(3.8 + 0.13 * 7.4, 6.8 - 0.9176 * 7.4, 1.5 - 0.3757 * 7.4);
  lounge.shadow.camera.near = 1;
  lounge.shadow.camera.far = 20;
  lounge.shadow.bias = -0.0004;
  lounge.shadow.normalBias = 0.03;
  // Penumbra of the 1.25 m disk (see softShadows.ts).
  lounge.shadow.radius = spotPenumbra(1, 20, 144, 1.25);
  lounge.shadow.autoUpdate = false;
  // Blue-hour accent lights of the source (Blender W, position, direction in glTF axes), all
  // 180° spread disks: P/π candela on the axis with a cosine falloff (SPOT_COSINE). The Daylight
  // scene keeps them near zero; the Night scene keeps the Blue hour power.
  const duskColor = new THREE.Color().setRGB(1, 0.7, 0.39, THREE.LinearSRGBColorSpace);
  const duskLights = (
    [
      // 'V10 lounge dusk fill': 2 m disk over the loungers.
      [42, [5.9, 2.8, 1.4], [-0.3142, -0.6569, -0.6854]],
      ...FOOTLIGHTS.map((position) => [8, position, FOOTLIGHT_DIRECTION] as const),
      // 'V10 specimen uplight' under the garden maple.
      [35, [0.5, 0.04, 5.7], [0.3186, 0.9344, 0.1593]],
    ] as const
  ).map(([watts, position, direction]) => {
    const light = new THREE.SpotLight(duskColor, 0, 0, Math.PI / 2, 1, 2);
    light.position.fromArray(position);
    light.target.position.fromArray(direction).add(light.position);
    light.userData.candela = watts / Math.PI;
    return light;
  });
  // The lounge fill is below/among the pergola beams: cache their occlusion instead of
  // letting its direct light pass through them.
  const duskLounge = duskLights[0];
  duskLounge.shadow.focus = 0.8;
  duskLounge.shadow.camera.near = 0.1;
  duskLounge.shadow.camera.far = 20;
  duskLounge.shadow.bias = -0.0001;
  duskLounge.shadow.normalBias = 0.015;
  duskLounge.shadow.radius = spotPenumbra(0.1, 20, 144, 2);
  duskLounge.shadow.autoUpdate = false;
  // The maple uplight must not shine through the trunk and canopy. The source is a 0.6 m
  // disk; its center-based shadow is an approximation of the disk's visibility.
  const maple = duskLights[4];
  maple.shadow.focus = 0.8;
  maple.shadow.camera.near = 0.1;
  maple.shadow.camera.far = 20;
  maple.shadow.bias = -0.0001;
  maple.shadow.normalBias = 0.015;
  maple.shadow.radius = spotPenumbra(0.1, 20, 144, 0.6);
  maple.shadow.autoUpdate = false;
  // The three low path disks are occluded by stepping stones and planting. Use the
  // source 0.28 m diameter; as with the other disks, visibility is sampled at the center.
  const pathLights = duskLights.slice(1, 4);
  for (const light of pathLights) {
    light.shadow.focus = 0.8;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = 20;
    light.shadow.bias = -0.0001;
    light.shadow.normalBias = 0.015;
    light.shadow.radius = spotPenumbra(0.1, 20, 144, 0.28);
    light.shadow.autoUpdate = false;
  }
  const shadowLights = [sun, lounge, ...duskLights];
  for (const light of shadowLights) narrowShadowColor(light.shadow);
  scene.add(sun, ...interior, lounge, lounge.target);
  for (const light of duskLights) scene.add(light, light.target);
  // Every source scene lights the courtyard along the 'Late afternoon sunlight' direction: the
  // Blue hour sun is a faint blue 0.045 and the night's moon (scripts/build_night_scene.py) a
  // pale 0.1 with a 0.5° disk. A fixed direction keeps the cached shadow valid.
  sun.position.set(-0.556, 0.6178, 0.556).multiplyScalar(50);
  const sunColors = [
    new THREE.Color('#fff1d5'),
    new THREE.Color().setRGB(0.47, 0.62, 1, THREE.LinearSRGBColorSpace),
    new THREE.Color().setRGB(0.62, 0.74, 1, THREE.LinearSRGBColorSpace),
  ];
  const sunIntensity = [3.2, 0.045, 0.1];
  const dot = (weights: number[], values: number[]) => weights.reduce((sum, w, i) => sum + w * values[i], 0);
  const overcast = new THREE.Color();
  let current = 0;
  let rain = 0;
  let snow = 0;
  return {
    irradiance,
    setShadowSize(size: number) {
      for (const light of shadowLights) {
        light.castShadow = size > 0;
        if (size) light.shadow.mapSize.setScalar(size);
        else {
          light.shadow.dispose();
          light.shadow.map = null;
          light.shadow.mapPass = null;
        }
        light.shadow.needsUpdate = true;
      }
    },
    // The static shadows are drawn once; objects added later need them drawn again.
    refreshShadows() {
      for (const light of shadowLights) light.shadow.needsUpdate = true;
    },
    // Light count is part of every shader, so this recompiles; only the quality setting calls it.
    setDuskLights(enabled: boolean) {
      for (const light of duskLights) light.visible = enabled;
    },
    /**
     * Runs `fn` with the light and shadow counts of a quality (what its programs depend on) and
     * restores the current ones; the shadow maps are left alone.
     */
    withQuality<T>(shadowSize: number, duskLightsOn: boolean, fn: () => T): T {
      const casts = shadowLights.map((light) => light.castShadow);
      const visible = duskLights.map((light) => light.visible);
      for (const light of shadowLights) light.castShadow = shadowSize > 0;
      for (const light of duskLights) light.visible = duskLightsOn;
      try {
        return fn();
      } finally {
        shadowLights.forEach((light, i) => (light.castShadow = casts[i]));
        duskLights.forEach((light, i) => (light.visible = visible[i]));
      }
    },
    dispose() {
      for (const light of shadowLights) light.shadow.dispose();
    },
    /** The smoothed time of day (see timeOfDay). */
    get time() {
      return current;
    },
    /** The smoothed share of the rain (0 clear, 1 rain). */
    get rain() {
      return rain;
    },
    /** The smoothed share of the snow (0 clear, 1 snow). */
    get snow() {
      return snow;
    },
    /** The share of the overcast: the rain's and the snow's together (their targets exclude each other). */
    get clouds() {
      return Math.min(1, rain + snow);
    },
    /** The overcast sky's radiance at its base (scene-linear), which the rain's drops carry. */
    get overcast() {
      return overcast;
    },
    /**
     * `target` is the time of day (timeOfDay); `rainTarget` and `snowTarget` are 1 for that weather;
     * `groundSnow` is 1 while snow lies on the ground (applied at once, as the season's surfaces are).
     */
    update(target: number, delta: number, immediate: boolean, rainTarget = 0, snowTarget = 0, groundSnow = 0) {
      // Exponential smoothing is independent of frame rate; reduced motion snaps.
      const step = 1 - Math.exp(-delta / SMOOTHING_SECONDS);
      current = immediate ? target : THREE.MathUtils.lerp(current, target, step);
      rain = immediate ? rainTarget : THREE.MathUtils.lerp(rain, rainTarget, step);
      snow = immediate ? snowTarget : THREE.MathUtils.lerp(snow, snowTarget, step);
      // Settles instead of approaching for ever (the mirror redraws while it changes).
      if (Math.abs(rain - rainTarget) < 1e-3) rain = rainTarget;
      if (Math.abs(snow - snowTarget) < 1e-3) snow = snowTarget;
      // Rain and snow share one overcast; between them it holds (the two approaches sum to 1).
      const clouds = Math.min(1, rain + snow);
      const weights = sceneWeights(current);
      // Blue hour and Night share the powers of every light but the sun and the baked sky fills.
      const dusk = 1 - weights[0];
      const sky0 = dot(weights, RAIN_SKY);
      overcast.setRGB(sky0 * RAIN_SKY_TINT[0], sky0 * RAIN_SKY_TINT[1], sky0 * RAIN_SKY_TINT[2]);
      sky.update(dusk, weights[2], clouds, overcast);
      irradiance.suiOvercast.value.set(
        THREE.MathUtils.lerp(1, dot(weights, RAIN_PROBES), clouds),
        THREE.MathUtils.lerp(1, dot(weights, RAIN_INDOOR), clouds),
        RAIN_DESATURATION * clouds,
        1 - clouds,
      );
      // Every light uses the source values of each scene; the probes mix the bakes.
      irradiance.suiIrradianceEvening.value = dusk;
      irradiance.suiIrradianceNight.value = weights[2];
      sun.color.setRGB(0, 0, 0);
      const clear = weights[0] * (1 - clouds);
      const boost = THREE.MathUtils.lerp(1, CLEAR_DAY_SUN, 1 - clouds);
      weights.forEach((w, i) =>
        sun.color.add(sunColors[i].clone().multiplyScalar(w * sunIntensity[i] * (i === 0 ? boost : 1))),
      );
      const peak = Math.max(sun.color.r, sun.color.g, sun.color.b);
      if (peak > 0) sun.color.multiplyScalar(1 / peak);
      sun.intensity = peak * (1 - clouds);
      sun.shadow.radius = THREE.MathUtils.lerp(sunPenumbra, moonPenumbra, weights[2]);
      lounge.intensity = THREE.MathUtils.lerp((950 / Math.PI) * boost, 0, dusk) * (1 - clouds);
      for (const light of duskLights) light.intensity = light.userData.candela * dusk;
      renderer.toneMappingExposure =
        2 **
        (dot(weights, EXPOSURE) +
          clouds * dot(weights, RAIN_EXPOSURE) +
          clear * CLEAR_DAY_EXPOSURE +
          groundSnow * weights[0] * SNOW_GROUND_EXPOSURE);
    },
  };
}
