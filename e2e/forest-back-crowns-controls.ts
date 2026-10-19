/** Omit only the added far rank, keeping all previous crowns and the backing sheet visible. */
export function omitFarCrowns() {
  const source = WebGL2RenderingContext.prototype.shaderSource;
  (window as any).farCrownControls = 0;
  WebGL2RenderingContext.prototype.shaderSource = function (shader, text) {
    const marker = '// SUI_FAR_CROWN_CONTROL';
    if (text.includes(marker)) {
      if (text.split(marker).length !== 2) throw Error('Ambiguous far-crown control');
      text = text.replace(marker, 'if (vGardenEdge > 15000.0) discard;');
      (window as any).farCrownControls++;
    }
    source.call(this, shader, text);
  };
}
