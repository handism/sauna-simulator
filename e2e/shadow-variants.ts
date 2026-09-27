// Browser-only rewrites of the PCSS in src/components/3d/softShadows.ts, for diagnostics: the
// production bundle, light uniforms and shadow maps stay intact. `from` is the bundle's
// [BLOCKER_SAMPLES, FILTER_SAMPLES]; `to` is the sample counts to measure, or 'hard' for a single
// depth comparison (a cost floor, not a proposed visual replacement).
export type ShadowSamples = readonly [blocker: number, filter: number];

export const PCSS_VARIANTS = {
  original: [16, 24],
  half: [8, 12],
  // A many-sample stand-in for the converged filter of the same kernel.
  reference: [64, 96],
  hard: 'hard',
} as const satisfies Record<string, ShadowSamples | 'hard'>;

export type ShadowVariant = keyof typeof PCSS_VARIANTS;

export function patchShadows({ from, to }: { from: readonly number[]; to: readonly number[] | 'hard' }) {
  const original = WebGL2RenderingContext.prototype.shaderSource;
  (window as unknown as { shadowPatches: number }).shadowPatches = 0;
  WebGL2RenderingContext.prototype.shaderSource = function (shader, source) {
    if (source.includes('float pcssNoise(')) {
      if (to === 'hard') {
        const start = source.indexOf('float getShadow(', source.indexOf('float pcssNoise('));
        const body = source.indexOf('{', start);
        if (start < 0 || body < 0) throw new Error('PCSS diagnostic no longer matches');
        source = `${source.slice(0, body + 1)}
          vec3 diagnosticCoord = shadowCoord.xyz / shadowCoord.w;
          if (diagnosticCoord.x < 0.0 || diagnosticCoord.x > 1.0 || diagnosticCoord.y < 0.0 || diagnosticCoord.y > 1.0 || diagnosticCoord.z > 1.0) return 1.0;
          return mix(1.0, step(diagnosticCoord.z + shadowBias, texture2D(shadowMap, diagnosticCoord.xy).r), shadowIntensity);
          ${source.slice(body + 1)}`;
      } else if (to[0] !== from[0] || to[1] !== from[1]) {
        // Only the PCSS functions: other chunks may contain the same loop text.
        const head = source.indexOf('float pcssNoise(');
        const patched =
          source.slice(0, head) +
          source
            .slice(head)
            .replace(`i < ${from[0]}; i ++`, `i < ${to[0]}; i ++`)
            .replace(`pcssDisk( i, ${from[0]}, phi )`, `pcssDisk( i, ${to[0]}, phi )`)
            .replace(`slope, radius, ${from[1]}, phi + 1.0`, `slope, radius, ${to[1]}, phi + 1.0`)
            .replace(`lit / ${from[1]}.0`, `lit / ${to[1]}.0`);
        if (!patched.includes(`pcssDisk( i, ${to[0]}, phi )`) || !patched.includes(`lit / ${to[1]}.0`))
          throw new Error('PCSS sample diagnostic no longer matches');
        source = patched;
      }
      (window as unknown as { shadowPatches: number }).shadowPatches++;
    }
    original.call(this, shader, source);
  };
}
