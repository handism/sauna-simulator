/**
 * Same-build control for the woodland cards' far alpha bias (leafCluster.ts `suiLeafBias`,
 * docs/3d-qa/leaf-alpha-bias/): read the mask unbiased again in the lit pass, the depth prepass and
 * the shadow mask, without changing other passes.
 */
export function restoreLeafAlpha() {
  const original = WebGL2RenderingContext.prototype.shaderSource;
  (window as any).shimmerControls = 0;
  WebGL2RenderingContext.prototype.shaderSource = function (shader, source) {
    for (const call of ['suiLeafBias( vAlphaMapUv )', 'suiLeafBias( vSuiAlphaMapUv )']) {
      const count = source.split(call).length - 1;
      if (count > 1) throw Error('Ambiguous leaf alpha control');
      if (count === 1) {
        source = source.replace(call, '0.0');
        (window as any).shimmerControls++;
      }
    }
    return original.call(this, shader, source);
  };
}
