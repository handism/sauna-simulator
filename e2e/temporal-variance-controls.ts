/** Same-build control: restore the previous temporal variance bound, without changing other passes. */
export function restoreTemporalVariance() {
  const original = WebGL2RenderingContext.prototype.shaderSource;
  (window as any).shimmerControls = 0;
  WebGL2RenderingContext.prototype.shaderSource = function (shader, source) {
    const marker = 'const float historySigma = 1.25;';
    if (source.includes(marker)) {
      if (source.split(marker).length !== 2) throw Error('Ambiguous temporal variance control');
      source = source.replace(marker, 'const float historySigma = 1.0;');
      (window as any).shimmerControls++;
    }
    return original.call(this, shader, source);
  };
}
