/** Restore the hazing before aerialPerspective.ts: clear lit surfaces, the far forest's fixed base haze. */
export function omitForestAir() {
  const source = WebGL2RenderingContext.prototype.shaderSource;
  (window as any).forestAirControls = 0;
  WebGL2RenderingContext.prototype.shaderSource = function (shader, text) {
    for (const [marker, code] of [
      ['// SUI_AIR_CONTROL', 'suiAir = 0.0;'],
      ['// SUI_FAR_AIR_CONTROL', 'haze = mix(0.025, 0.08, vGardenDepth);'],
    ]) {
      if (!text.includes(marker)) continue;
      if (text.split(marker).length !== 2) throw Error(`Ambiguous control ${marker}`);
      text = text.replace(marker, code);
      (window as any).forestAirControls++;
    }
    source.call(this, shader, text);
  };
}
