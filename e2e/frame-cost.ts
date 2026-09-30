// Frame cost diagnostics that change shaders and GL state inside the test browser only (the
// product is unchanged). Installed before the app loads, like gpu-timer.ts.
//
// ANGLE's Metal backend does not split the GPU time of one frame: consecutive timer queries each
// return about the whole frame. So costs are found by ablation of whole frames instead.

/**
 * `trivial`: every scene fragment shader returns a constant at once (the tone mapping pass is kept),
 * leaving vertex work, rasterization, MSAA, the resolve and the full-screen pass. Alpha tested
 * leaves become whole quads, so the floor is slightly overstated where foliage is seen.
 * `overdraw`: shaders run in full, then write 1 into red with additive blending forced on; the
 * tone mapping pass writes the count / 32, and `suiOverdraw` reads the canvas after a frame.
 * `discard`: a discard that never runs, which keeps the image but stops a tile based GPU from
 * removing hidden opaque fragments before shading (Apple's HSR): the cost then shows overdraw.
 * `noshadow-<light>`: one light's shadow lookup is skipped (the light stays lit, unshadowed), which
 * leaves the cost of that light's PCSS as the difference to the product: `sun` (the only
 * directional light), `spot0`..`spot5` (three's order of shadow casting spots: the V9 lounge disk,
 * then the dusk fill, path lights 1/4/7 and the maple uplight of lighting.ts), or `all`. The
 * receiver slope (suiShadowSlope, two derivatives) stays.
 * `rolled`: the PCSS sample loops (softShadows.ts) count to their constant plus a uniform left at 0,
 * so the compiler cannot unroll them: the same work in far less code.
 */
export type FrameCostMode =
  'trivial' | 'overdraw' | 'discard' | 'rolled' | `noshadow-${'all' | 'sun' | `spot${number}`}`;

export function patchFrameCost(mode: FrameCostMode) {
  type Overdraw = Window & {
    suiOverdrawGl?: WebGL2RenderingContext;
    suiOverdrawRead?: boolean;
    suiOverdraw?: number[] | null;
    suiShadowSkips?: number;
  };
  const w = window as unknown as Overdraw;
  const proto = WebGL2RenderingContext.prototype;
  const shaderSource = proto.shaderSource;
  const main = /void\s+main\s*\(\s*\)\s*\{/;
  proto.shaderSource = function (shader, source) {
    const fragment = source.includes('pc_fragColor') && main.test(source);
    if (fragment && source.includes('uniform sampler2D tScene')) {
      if (mode === 'overdraw')
        source = source.replace(
          main,
          'void main() { pc_fragColor = vec4( texture( tScene, vUv ).r / 32.0, 0.0, 0.0, 1.0 ); return;',
        );
    } else if (fragment && mode === 'rolled') {
      const head = source.indexOf('float pcssNoise(');
      if (head >= 0) {
        const pcss = source.slice(head).replace(/i < (\d+|count); i \+\+/g, (_, n) => {
          w.suiShadowSkips = (w.suiShadowSkips ?? 0) + 1;
          return `i < ${n} + suiPcssZero; i ++`;
        });
        source = `${source.slice(0, head)}uniform int suiPcssZero;\n\t${pcss}`;
      }
    } else if (fragment && mode.startsWith('noshadow-')) {
      const light = mode.slice('noshadow-'.length);
      // The lookups of softShadows.ts after three unrolls the light loops.
      const call =
        light === 'all'
          ? '\\w+\\( (?:directLight\\.color, )?(?:directional|spot)ShadowMap\\[ \\d+ \\]'
          : light === 'sun'
            ? 'suiSunShadow\\( directLight\\.color, directionalShadowMap\\[ 0 \\]'
            : `getShadow\\( spotShadowMap\\[ ${light.slice('spot'.length)} \\]`;
      source = source.replace(
        new RegExp(`\\( directLight\\.visible && receiveShadow && SUI_SHADOW_FACING \\) \\? (?=${call})`, 'g'),
        () => {
          w.suiShadowSkips = (w.suiShadowSkips ?? 0) + 1;
          return 'false ? ';
        },
      );
    } else if (fragment) {
      if (mode === 'trivial') source = source.replace(main, 'void main() { pc_fragColor = vec4( 0.2 ); return;');
      else if (mode === 'discard') source = source.replace(main, 'void main() { if ( gl_FragCoord.x < -1.0 ) discard;');
      else {
        const end = source.lastIndexOf('}');
        source = `${source.slice(0, end)}\tpc_fragColor = vec4( 1.0, 0.0, 0.0, 1.0 );\n}${source.slice(end + 1)}`;
      }
    }
    return shaderSource.call(this, shader, source);
  };
  if (mode !== 'overdraw') return;
  const enable = proto.enable;
  const disable = proto.disable;
  proto.disable = function (cap) {
    if (cap === this.BLEND) return enable.call(this, cap);
    return disable.call(this, cap);
  };
  proto.enable = function (cap) {
    const result = enable.call(this, cap);
    if (cap === this.BLEND) {
      proto.blendEquation.call(this, this.FUNC_ADD);
      blendFunc.call(this, this.ONE, this.ONE);
    }
    return result;
  };
  const blendFunc = proto.blendFunc;
  proto.blendFunc = function () {
    return blendFunc.call(this, this.ONE, this.ONE);
  };
  proto.blendFuncSeparate = function () {
    return blendFunc.call(this, this.ONE, this.ONE);
  };
  proto.blendEquationSeparate = function () {
    return proto.blendEquation.call(this, this.FUNC_ADD);
  };
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, options?: unknown) {
    const context = getContext.call(this, type, options) as RenderingContext | null;
    if (type === 'webgl2' && context && !w.suiOverdrawGl) w.suiOverdrawGl = context as WebGL2RenderingContext;
    return context;
  } as typeof getContext;
  const frame = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) =>
    frame((time) => {
      callback(time);
      const gl = w.suiOverdrawGl;
      if (!gl || !w.suiOverdrawRead) return;
      // Read in the same task as the frame, before the canvas is presented and cleared.
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      const pixels = new Uint8Array(width * height * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      // Histogram of the layers per pixel (0..32; the resolve averages the MSAA samples at edges).
      const histogram = new Array(33).fill(0);
      for (let i = 0; i < pixels.length; i += 4) histogram[Math.min(32, Math.round((pixels[i] / 255) * 32))]++;
      w.suiOverdraw = histogram;
      w.suiOverdrawRead = false;
    });
}
