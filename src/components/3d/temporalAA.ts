import * as THREE from 'three';

// Leaves and thin branches of about a pixel pop in and out between pixels while looking around
// (docs/3d-qa/crown-shimmer/). Each stage's camera only turns (lookControls.ts), so the previous
// frame maps onto this one by a homography whatever the depth: this blends the resolved HDR image
// with that reprojected history before tone mapping. Without jitter a still view converges to the
// frame itself, bit for bit, so still images are unchanged; turning, the history halves the popping
// (docs/3d-qa/temporal-aa/). Once converged, a still view skips the pass.

/** The history's weight once valid. */
export const HISTORY_WEIGHT = 0.9;
/**
 * A turn beyond this between two frames (radians) drops the history: a jump, not a look. A finger's
 * swipe turns about 0.07 a frame at 60 Hz and still gains nearly as much from the history as a slow
 * drag (docs/3d-qa/temporal-aa/); an arrow key's step resets the history itself (lookControls.ts).
 */
export const JUMP_ANGLE = 0.25;
/**
 * Still frames drawn through the pass before it is skipped. A pause between pointer events keeps
 * the blend (the blended and the plain frame in turn would flicker), and 0.9^60 leaves 0.2% of a
 * gap, under the shader's tolerance: the step to the plain frame shows nothing.
 */
export const STILL_FRAMES = 60;

const vertexShader = /* glsl */ `varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

// Colors are blended as c / (1 + max(c)) in YCoCg, so a bright sky sample does not outweigh a dark
// leaf. The history is clamped to the 3×3 neighbourhood's mean ± standard deviation, widened to
// hold this pixel: a box without it pulled a still view toward the mean every frame (a blur).
const fragmentShader = /* glsl */ `uniform sampler2D tCurrent;
uniform sampler2D tHistory;
uniform mat4 reprojection;
uniform vec2 texel;
uniform float historyWeight;
varying vec2 vUv;
// Beyond the half float range (inf) a pixel would turn NaN below and spread through the history.
vec3 finite( vec3 c ) {
	return any( isnan( c ) ) ? vec3( 0.0 ) : min( c, vec3( 65504.0 ) );
}
vec3 compress( vec3 c ) {
	return c / ( 1.0 + max( max( c.r, c.g ), c.b ) );
}
vec3 expand( vec3 c ) {
	return c / max( 1.0 - max( max( c.r, c.g ), c.b ), 1e-4 );
}
vec3 toYCoCg( vec3 c ) {
	return vec3( dot( c, vec3( 0.25, 0.5, 0.25 ) ), dot( c, vec3( 0.5, 0.0, -0.5 ) ), dot( c, vec3( -0.25, 0.5, -0.25 ) ) );
}
vec3 fromYCoCg( vec3 c ) {
	return vec3( c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z );
}
vec3 historyAt( vec2 uv ) {
	vec2 p = uv / texel;
	// On a texel centre (a still view), exactly: the filter's subtexel precision would mix in a
	// little of the neighbours every frame.
	if ( all( lessThan( abs( p - floor( p ) - 0.5 ), vec2( 1.0 / 512.0 ) ) ) ) return texelFetch( tHistory, ivec2( p ), 0 ).rgb;
	// Catmull-Rom from five bilinear taps (the corners dropped).
	vec2 c = floor( p - 0.5 ) + 0.5;
	vec2 f = p - c;
	vec2 w0 = f * ( -0.5 + f * ( 1.0 - 0.5 * f ) );
	vec2 w1 = 1.0 + f * f * ( -2.5 + 1.5 * f );
	vec2 w2 = f * ( 0.5 + f * ( 2.0 - 1.5 * f ) );
	vec2 w3 = f * f * ( -0.5 + 0.5 * f );
	vec2 w12 = w1 + w2;
	vec2 t0 = ( c - 1.0 ) * texel;
	vec2 t3 = ( c + 2.0 ) * texel;
	vec2 t12 = ( c + w2 / w12 ) * texel;
	vec3 sum = texture2D( tHistory, vec2( t12.x, t0.y ) ).rgb * w12.x * w0.y
		+ texture2D( tHistory, vec2( t0.x, t12.y ) ).rgb * w0.x * w12.y
		+ texture2D( tHistory, t12 ).rgb * w12.x * w12.y
		+ texture2D( tHistory, vec2( t3.x, t12.y ) ).rgb * w3.x * w12.y
		+ texture2D( tHistory, vec2( t12.x, t3.y ) ).rgb * w12.x * w3.y;
	float weight = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
	return max( sum / weight, 0.0 );
}
void main() {
	vec3 m1 = vec3( 0.0 );
	vec3 m2 = vec3( 0.0 );
	vec3 linear = vec3( 0.0 );
	vec3 current = vec3( 0.0 );
	// Texels exactly: a filtered read of this frame would differ from the tone mapping pass's.
	ivec2 pixel = ivec2( gl_FragCoord.xy );
	ivec2 last = textureSize( tCurrent, 0 ) - 1;
	for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {
		vec3 c = finite( texelFetch( tCurrent, clamp( pixel + ivec2( x, y ), ivec2( 0 ), last ), 0 ).rgb );
		vec3 s = toYCoCg( compress( c ) );
		if ( x == 0 && y == 0 ) {
			linear = c;
			current = s;
		}
		m1 += s;
		m2 += s * s;
	}
	vec3 mean = m1 / 9.0;
	vec3 sigma = sqrt( max( m2 / 9.0 - mean * mean, 0.0 ) );
	// Where this pixel's far point was in the previous frame.
	vec4 clip = reprojection * vec4( vUv * 2.0 - 1.0, 1.0, 1.0 );
	vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
	bool seen = clip.w > 0.0 && all( greaterThanEqual( uv, vec2( 0.0 ) ) ) && all( lessThanEqual( uv, vec2( 1.0 ) ) );
	vec3 history = toYCoCg( compress( finite( historyAt( uv ) ) ) );
	history = clamp( history, min( mean - sigma, current ), max( mean + sigma, current ) );
	vec3 blended = mix( current, history, seen ? historyWeight : 0.0 );
	// A history that is this frame up to the half floats' rounding (a still view) gives the frame
	// itself, bit for bit. Blending it in stops moving once a tenth of the gap rounds away (up to
	// five half float steps, about 0.25%), which can show a level off for good.
	vec3 peak = compress( linear );
	bool same = all( lessThanEqual( abs( blended - current ), vec3( 6e-3 * max( max( peak.r, peak.g ), peak.b ) + 1e-6 ) ) );
	gl_FragColor = vec4( same ? linear : expand( fromYCoCg( blended ) ), 1.0 );
}`;

/**
 * The matrix from this frame's clip position of a pixel's far point to the previous frame's:
 * `previousViewProjection` · camera.matrixWorld · camera.projectionMatrixInverse.
 */
export function reprojectionMatrix(
  previousViewProjection: THREE.Matrix4,
  camera: THREE.PerspectiveCamera,
  out = new THREE.Matrix4(),
) {
  return out.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse).premultiply(previousViewProjection);
}

/**
 * Two half-float histories, drawn in turn. `resolve` takes the resolved scene of a camera whose
 * world matrix is current (after the frame's render) and returns the texture to tone map: that
 * scene itself once a still view has converged.
 */
export function createTemporalAA(renderer: THREE.WebGLRenderer) {
  const make = () =>
    new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
  const targets = [make(), make()];
  let index = 0;
  let valid = false;
  let still = 0;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tCurrent: { value: null as THREE.Texture | null },
      tHistory: { value: null as THREE.Texture | null },
      reprojection: { value: new THREE.Matrix4() },
      texel: { value: new THREE.Vector2() },
      historyWeight: { value: 0 },
    },
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const screen = new THREE.Camera();
  const previousViewProjection = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  return {
    /** Starts over from the next frame (the image changed other than by turning). */
    reset() {
      valid = false;
    },
    resolve(current: THREE.Texture, camera: THREE.PerspectiveCamera, width: number, height: number) {
      for (const target of targets)
        if (target.width !== width || target.height !== height) {
          target.setSize(width, height);
          valid = false;
        }
      // Another stage's view (or a jump) is not reprojected; the projection changes with it.
      if (!camera.position.equals(position) || camera.quaternion.angleTo(quaternion) > JUMP_ANGLE) valid = false;
      if (camera.position.equals(position) && camera.quaternion.equals(quaternion)) still++;
      else still = 0;
      // Converged on a still view: the frame itself. The steam and the water move on meanwhile, so
      // the next turn starts over (from the frame shown).
      if (still > STILL_FRAMES) {
        valid = false;
        return current;
      }
      position.copy(camera.position);
      quaternion.copy(camera.quaternion);
      const uniforms = material.uniforms;
      reprojectionMatrix(previousViewProjection, camera, uniforms.reprojection.value);
      previousViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const write = targets[1 - index];
      uniforms.tCurrent.value = current;
      uniforms.tHistory.value = targets[index].texture;
      uniforms.texel.value.set(1 / width, 1 / height);
      uniforms.historyWeight.value = valid ? HISTORY_WEIGHT : 0;
      renderer.setRenderTarget(write);
      renderer.render(quad, screen);
      index = 1 - index;
      valid = true;
      return write.texture;
    },
    /** Releases the histories (allocated again by the next `resolve`). */
    release() {
      for (const target of targets) target.dispose();
      valid = false;
    },
    dispose() {
      for (const target of targets) target.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
export type TemporalAA = ReturnType<typeof createTemporalAA>;
