/**
 * Same-build candidates for the grain left inside the woodland crowns while looking around
 * (docs/3d-qa/crown-grain/): each rewrites one part of the cards' shaders in the verification browser
 * only. `tint` gives every card the same tint and shade (crownNormals.ts `suiCrownTint`), `bias` reads
 * the blurrier mip from 1.5→3 texels instead of 2→4 (leafCluster.ts `suiLeafBias`).
 */
export function applyCrownGrain(variant: string) {
  const edits: Record<string, [string, string][]> = {
    tint: [['diffuseColor.rgb *= vSuiCrownTint;', 'diffuseColor.rgb *= vec3( 0.86 );']],
    bias: [['smoothstep( 2.0, 4.0, suiLeafFootprint( uv ) )', 'smoothstep( 1.5, 3.0, suiLeafFootprint( uv ) )']],
  };
  const pairs = edits[variant];
  if (!pairs) throw Error(`Unknown crown grain variant ${variant}`);
  const original = WebGL2RenderingContext.prototype.shaderSource;
  (window as any).shimmerControls = 0;
  WebGL2RenderingContext.prototype.shaderSource = function (shader, source) {
    for (const [from, to] of pairs) {
      const count = source.split(from).length - 1;
      if (count > 1) throw Error('Ambiguous crown grain control');
      if (count === 1) {
        source = source.replace(from, to);
        (window as any).shimmerControls++;
      }
    }
    return original.call(this, shader, source);
  };
}
