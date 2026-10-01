// Frame cost diagnostics that change shaders and GL state inside the test browser only (the
// product is unchanged). Installed before the app loads, like gpu-timer.ts.
//
// ANGLE's Metal backend does not split the GPU time of one frame: consecutive timer queries each
// return about the whole frame. So costs are found by ablation of whole frames instead.

/**
 * `trivial`: every scene fragment shader returns a constant at once (the tone mapping pass is kept),
 * leaving vertex work, rasterization, MSAA, the resolve and the full-screen pass. Alpha tested
 * leaves become whole quads, so the floor is slightly overstated where foliage is seen.
 * `trivial-with-<NAME>` / `trivial-without-<NAME>`: the same only in the programs that do or do not
 * `#define NAME` or declare a uniform NAME, e.g. `trivial-with-SUI_REFRACTION` for the surfaces
 * under the water or `trivial-with-suiMirror` for the water surface.
 * `overdraw`: shaders run in full, then write 1 into red with additive blending forced on; the
 * tone mapping pass writes the count / 32, and `suiOverdraw` reads the canvas after a frame.
 * `discard`: a discard that never runs, which keeps the image but stops a tile based GPU from
 * removing hidden opaque fragments before shading (Apple's HSR): the cost then shows overdraw.
 * `noshadow-<light>`: one light's shadow lookup is skipped (the light stays lit, unshadowed), which
 * leaves the cost of that light's PCSS as the difference to the product: `sun` (the only
 * directional light), `spot0`..`spot5` (three's order of shadow casting spots: the V9 lounge disk,
 * then the dusk fill, path lights 1/4/7 and the maple uplight of lighting.ts), or `all`. The
 * receiver slope (suiShadowSlope, two derivatives) stays. Materials that read the half-resolution
 * shadow mask (shadowMask.ts) lose that read instead; the mask pass still runs. `with-<DEFINE>` and
 * `without-<DEFINE>` skip every light's lookups only in the programs that #define it or that do
 * not, e.g. `without-SUI_SHADOW_MASK` for every surface evaluating its own PCSS, `with-SUI_SIDE_IMAGE`
 * for the images in the water's sides, `with-USE_ALPHATEST` for the leaves.
 * `cut-<part>`: one part of the pool floor's shading (waterBottom.ts, caustics.ts) is skipped, by
 * CUTS below: `bottom` the reflection off the water's bottom, `tilt` its four tilted traces that
 * tell where the bump matters, `bump` the bumped trace those choose (which leaves `near` unused, so
 * the compiler drops the tilted traces too: about `tilt`), `bumpnever` the same bumped trace kept
 * but never run, `bumpall` the bumped trace run everywhere (the tilted traces dropped), `caustic`
 * the caustics and `voronoi`, `warp` and `visibility` the caustics' Voronoi edges, the noise that
 * warps them and the noise that fades them, `wet` the highlights through the water, `wetimage`
 * their paths off the sides (suiWetImage's loop) and `wetimagenever` that loop kept but never run.
 * A part kept but never run costs what its code alone costs (registers): `bumpnever` nothing,
 * `wetimagenever` about half of `wetimage` (docs/3d-qa/tilt-cost). The replacements are in
 * patchFrameCost, which the page gets alone.
 * `rolled`: the PCSS sample loops (softShadows.ts) count to their constant plus a uniform left at 0,
 * so the compiler cannot unroll them: the same work in far less code.
 * `rotate`: pcssDisk rotates a constant Vogel point by phi (cos/sin of phi, shared by the unrolled
 * samples) instead of taking sqrt, cos and sin of each sample's angle: the same disk.
 * `depth16`: every depth texture (the app's are all shadow maps) is allocated as DEPTH_COMPONENT16
 * instead of three's DEPTH_COMPONENT24 (32-bit float on Apple GPUs), halving the bytes read.
 */
export type FrameCostMode =
  | 'trivial'
  | `trivial-${'with' | 'without'}-${string}`
  | `cut-${(typeof CUTS)[number]}`
  | 'overdraw'
  | 'discard'
  | 'rolled'
  | 'rotate'
  | 'depth16'
  | `noshadow-${'all' | 'sun' | `spot${number}` | `with-${string}` | `without-${string}`}`;

export const CUTS = [
  'bottom',
  'tilt',
  'bump',
  'bumpnever',
  'bumpall',
  'caustic',
  'voronoi',
  'warp',
  'visibility',
  'wet',
  'wetimage',
  'wetimagenever',
] as const;

export function patchFrameCost(mode: FrameCostMode) {
  type Overdraw = Window & {
    suiOverdrawGl?: WebGL2RenderingContext;
    suiOverdrawRead?: boolean;
    suiOverdraw?: number[] | null;
    suiShadowSkips?: number;
  };
  const w = window as unknown as Overdraw;
  const cuts: Record<string, [string, string]> = {
    bottom: [
      'vec4 suiBottom = suiBottomReflection(',
      'vec4 suiBottom = vec4( 0.0 ); if ( false ) suiBottom = suiBottomReflection(',
    ],
    tilt: ['for ( int k = 0; k < 4; k ++ ) {', 'for ( int k = 0; k < 0; k ++ ) {'],
    bump: ['if ( near ) {', 'if ( false ) {'],
    bumpall: ['if ( near ) {', 'if ( true ) {'],
    caustic: [
      'float sui_caustic_strength( vec3 p, float footprint ) {',
      'float sui_caustic_strength( vec3 p, float footprint ) { return 0.0;',
    ],
    voronoi: [
      'float sui_voronoi_edge( vec3 coord ) {',
      'float sui_voronoi_edge( vec3 coord ) { return fract( coord.x );',
    ],
    warp: ['vec3 warp = p + 0.2 * sui_noise_color(', 'vec3 warp = p; if ( false ) warp = p + 0.2 * sui_noise_color('],
    visibility: [
      'float visibility = mix( 0.04, 0.48,',
      'float visibility = 0.3; if ( false ) visibility = mix( 0.04, 0.48,',
    ],
    wet: ['if ( suiUnderwater ) {\n\tsuiWetSpecular', 'if ( false ) {\n\tsuiWetSpecular'],
    bumpnever: ['if ( near ) {', 'if ( near && gl_FragCoord.x < - 1.0 ) {'],
    wetimagenever: ['if ( suiSpot < 0 ) continue;', 'if ( suiSpot < 0 || gl_FragCoord.x > - 1.0 ) continue;'],
    wetimage: [
      'for ( int suiLight = 0; suiLight < 2; suiLight ++ ) {',
      'for ( int suiLight = 0; suiLight < 0; suiLight ++ ) {',
    ],
  };
  const proto = WebGL2RenderingContext.prototype;
  const shaderSource = proto.shaderSource;
  const main = /void\s+main\s*\(\s*\)\s*\{/;
  // Whether a `noshadow-` mode skips the lookups of this program (inside: the page gets this
  // function's source alone).
  const trivialProgram = (source: string) => {
    const [, kind, name] = mode.match(/^trivial-(with|without)-(\w+)$/) ?? [];
    if (!kind) return mode === 'trivial';
    const found = new RegExp(`#define ${name}\\b|uniform \\w+ ${name}\\b`).test(source);
    if (found === (kind === 'with')) w.suiShadowSkips = (w.suiShadowSkips ?? 0) + 1;
    return found === (kind === 'with');
  };
  const shadowedProgram = (source: string) => {
    const [, kind, define] = mode.match(/^noshadow-(with|without)-(\w+)$/) ?? [];
    return !kind || new RegExp(`#define ${define}\\b`).test(source) === (kind === 'with');
  };
  if (mode === 'depth16') {
    const texStorage2D = proto.texStorage2D;
    proto.texStorage2D = function (target, levels, format, width, height) {
      if (format === this.DEPTH_COMPONENT24) {
        format = this.DEPTH_COMPONENT16;
        w.suiShadowSkips = (w.suiShadowSkips ?? 0) + 1;
      }
      return texStorage2D.call(this, target, levels, format, width, height);
    };
    const texImage2D = proto.texImage2D as (...args: unknown[]) => void;
    proto.texImage2D = function (this: WebGL2RenderingContext, ...args: unknown[]) {
      if (args[2] === this.DEPTH_COMPONENT24) {
        args[2] = this.DEPTH_COMPONENT16;
        w.suiShadowSkips = (w.suiShadowSkips ?? 0) + 1;
      }
      return texImage2D.apply(this, args);
    } as typeof proto.texImage2D;
    return;
  }
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
    } else if (fragment && mode === 'rotate') {
      const disk =
        'float r = sqrt( ( float( index ) + 0.5 ) / float( count ) );\n\t\tfloat theta = float( index ) * 2.399963229728653 + phi;\n\t\treturn vec2( cos( theta ), sin( theta ) ) * r;';
      if (source.includes(disk)) {
        w.suiShadowSkips = (w.suiShadowSkips ?? 0) + 1;
        source = source.replace(
          disk,
          'float r = sqrt( ( float( index ) + 0.5 ) / float( count ) );\n\t\tfloat a = float( index ) * 2.399963229728653;\n\t\tvec2 d = vec2( cos( a ), sin( a ) ) * r;\n\t\tfloat c = cos( phi ), s = sin( phi );\n\t\treturn vec2( c * d.x - s * d.y, s * d.x + c * d.y );',
        );
      }
    } else if (fragment && mode.startsWith('cut-')) {
      const [find, replace] = cuts[mode.slice('cut-'.length)];
      if (source.includes(find)) {
        w.suiShadowSkips = (w.suiShadowSkips ?? 0) + 1;
        source = source.split(find).join(replace);
      }
    } else if (fragment && mode.startsWith('noshadow-') && shadowedProgram(source)) {
      const light = mode.slice('noshadow-'.length);
      // The lookups of softShadows.ts after three unrolls the light loops.
      const call =
        light === 'all' || light.startsWith('with-') || light.startsWith('without-')
          ? '\\w+\\( (?:directLight\\.color, )?(?:directional|spot)ShadowMap\\[ \\d+ \\]'
          : light === 'sun'
            ? 'suiSunShadow\\( directLight\\.color, directionalShadowMap\\[ 0 \\]'
            : `getShadow\\( spotShadowMap\\[ ${light.slice('spot'.length)} \\]`;
      source = source.replace(
        new RegExp(
          `\\( directLight\\.visible && receiveShadow && SUI_SHADOW_FACING \\) \\? (?:SUI_MASKED\\( [^)]* \\) )?(?=${call})`,
          'g',
        ),
        () => {
          w.suiShadowSkips = (w.suiShadowSkips ?? 0) + 1;
          return 'false ? ';
        },
      );
    } else if (fragment && !mode.startsWith('noshadow-')) {
      if (mode.startsWith('trivial')) {
        if (trivialProgram(source)) source = source.replace(main, 'void main() { pc_fragColor = vec4( 0.2 ); return;');
      } else if (mode === 'discard')
        source = source.replace(main, 'void main() { if ( gl_FragCoord.x < -1.0 ) discard;');
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
