// Browser-only rewrites of the PCSS in src/components/3d/softShadows.ts, for diagnostics: the
// production bundle, light uniforms and shadow maps stay intact. `from` is the bundle's
// [BLOCKER_SAMPLES, FILTER_SAMPLES]; `to` is the sample counts to measure, or 'hard' for a single
// depth comparison (a cost floor, not a proposed visual replacement).
//
// Sample-placement options (same kernel, different variance):
// - jitter: each pixel also offsets the Vogel radii by its own noise (the rotation alone keeps
//   every pixel's samples on the same rings).
// - adaptive [first, extra]: filter with `first` samples, and only where they disagree (a
//   penumbra) add `extra` samples from a second, differently rotated disk.
//
// Per-light counts: `lite` routes one light type's lookups to a copy of getShadow with `samples`
// (constant loops, as a production split would compile), leaving the other type at the bundle's.
export type ShadowSamples = readonly [blocker: number, filter: number];
export type ShadowPlacement = { jitter?: boolean; adaptive?: readonly [first: number, extra: number] };
export type ShadowPerLight = { lite: 'directional' | 'spot'; samples: ShadowSamples };

export const PCSS_VARIANTS = {
  original: [16, 24],
  half: [8, 12],
  // A many-sample stand-in for the converged filter of the same kernel.
  reference: [64, 96],
  // Each stage of the reference alone: where the original's error comes from.
  'blocker-64': [64, 24],
  'filter-96': [16, 96],
  hard: 'hard',
  jitter: { jitter: true },
  'adaptive-8-24': { adaptive: [8, 24] },
  'adaptive-8-40': { adaptive: [8, 40] },
  'jitter-adaptive-8-24': { jitter: true, adaptive: [8, 24] },
  'adaptive-12-36': { adaptive: [12, 36] },
  'adaptive-16-32': { adaptive: [16, 32] },
  'sun-half': { lite: 'directional', samples: [8, 12] },
  'sun-quarter': { lite: 'directional', samples: [4, 6] },
  'spots-half': { lite: 'spot', samples: [8, 12] },
  // The split itself at unchanged counts: the cost of a second PCSS function in the shader.
  'sun-split': { lite: 'directional', samples: [16, 24] },
} as const satisfies Record<string, ShadowSamples | 'hard' | ShadowPlacement | ShadowPerLight>;

export type ShadowVariant = keyof typeof PCSS_VARIANTS;

export function patchShadows({
  from,
  to,
}: {
  from: readonly number[];
  to: readonly number[] | 'hard' | ShadowPlacement | ShadowPerLight;
}) {
  const original = WebGL2RenderingContext.prototype.shaderSource;
  (window as unknown as { shadowPatches: number }).shadowPatches = 0;
  const replace = (source: string, text: string, by: string) => {
    if (!source.includes(text)) throw new Error(`PCSS diagnostic no longer matches: ${text}`);
    return source.replace(text, by);
  };
  WebGL2RenderingContext.prototype.shaderSource = function (shader, source) {
    if (source.includes('float pcssNoise(')) {
      // Only the PCSS functions: other chunks may contain the same loop text.
      const head = source.indexOf('float pcssNoise(');
      let pcss = source.slice(head);
      if (to === 'hard') {
        const start = pcss.indexOf('float getShadow(');
        const body = pcss.indexOf('{', start);
        if (start < 0 || body < 0) throw new Error('PCSS diagnostic no longer matches');
        pcss = `${pcss.slice(0, body + 1)}
          vec3 diagnosticCoord = shadowCoord.xyz / shadowCoord.w;
          if (diagnosticCoord.x < 0.0 || diagnosticCoord.x > 1.0 || diagnosticCoord.y < 0.0 || diagnosticCoord.y > 1.0 || diagnosticCoord.z > 1.0) return 1.0;
          return mix(1.0, step(diagnosticCoord.z + shadowBias, texture2D(shadowMap, diagnosticCoord.xy).r), shadowIntensity);
          ${pcss.slice(body + 1)}`;
      } else if (Array.isArray(to)) {
        if (to[0] !== from[0] || to[1] !== from[1]) {
          pcss = replace(pcss, `i < ${from[0]}; i ++`, `i < ${to[0]}; i ++`);
          pcss = replace(pcss, `pcssDisk( i, ${from[0]}, phi )`, `pcssDisk( i, ${to[0]}, phi )`);
          pcss = replace(pcss, `slope, radius, ${from[1]}, phi + 1.0`, `slope, radius, ${to[1]}, phi + 1.0`);
          pcss = replace(pcss, `lit / ${from[1]}.0`, `lit / ${to[1]}.0`);
        }
      } else if ('lite' in to) {
        const tail = `return mix( 1.0, lit / ${from[1]}.0, shadowIntensity );\n\n\t}`;
        const start = pcss.indexOf('float getShadow(');
        const end = pcss.indexOf(tail, start) + tail.length;
        if (start < 0 || end < tail.length) throw new Error('PCSS diagnostic no longer matches');
        let lite = pcss.slice(start, end).replace('float getShadow(', 'float getShadowLite(');
        lite = replace(lite, `i < ${from[0]}; i ++`, `i < ${to.samples[0]}; i ++`);
        lite = replace(lite, `pcssDisk( i, ${from[0]}, phi )`, `pcssDisk( i, ${to.samples[0]}, phi )`);
        lite = replace(lite, `slope, radius, ${from[1]}, phi + 1.0`, `slope, radius, ${to.samples[1]}, phi + 1.0`);
        lite = replace(lite, `lit / ${from[1]}.0`, `lit / ${to.samples[1]}.0`);
        const call = `getShadow( ${to.lite}ShadowMap[`;
        if (!pcss.includes(call)) throw new Error(`PCSS diagnostic no longer matches: ${call}`);
        pcss = `${pcss.slice(0, end)}\n\n\t${lite}${pcss.slice(end).replaceAll(call, `getShadowLite( ${to.lite}ShadowMap[`)}`;
      } else {
        const placement = to as ShadowPlacement;
        if (placement.jitter) {
          pcss = replace(pcss, 'float pcssNoise(', 'float pcssJitter = 0.5;\n\tfloat pcssNoise(');
          pcss = replace(pcss, '( float( index ) + 0.5 )', '( float( index ) + pcssJitter )');
          // Interleaved gradient noise shifted by a large offset decorrelates it from the rotation.
          pcss = replace(
            pcss,
            'float phi = pcssNoise( gl_FragCoord.xy ) * PI2;',
            'float phi = pcssNoise( gl_FragCoord.xy ) * PI2;\n\t\tpcssJitter = pcssNoise( gl_FragCoord.yx + vec2( 47.0, 17.0 ) );',
          );
        }
        if (placement.adaptive) {
          const [first, extra] = placement.adaptive;
          pcss = replace(
            pcss,
            `float lit = pcssFilter( shadowMap, shadowCoord.xyz, slope, radius, ${from[1]}, phi + 1.0 );\n\t\treturn mix( 1.0, lit / ${from[1]}.0, shadowIntensity );`,
            `float lit = pcssFilter( shadowMap, shadowCoord.xyz, slope, radius, ${first}, phi + 1.0 );
		if ( lit == 0.0 || lit == ${first}.0 ) return mix( 1.0, lit / ${first}.0, shadowIntensity );
		lit += pcssFilter( shadowMap, shadowCoord.xyz, slope, radius, ${extra}, phi + 2.5 );
		return mix( 1.0, lit / ${first + extra}.0, shadowIntensity );`,
          );
        }
      }
      source = source.slice(0, head) + pcss;
      (window as unknown as { shadowPatches: number }).shadowPatches++;
    }
    original.call(this, shader, source);
  };
}
