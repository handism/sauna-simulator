import * as THREE from 'three';
import type { RenderStats } from './hdrOutput';

// The mirror image on the plunge. The source water is a clear surface with roughness 0.018, so
// Cycles shows a sharp reflection of the tub walls above the water and of the courtyard, rippled
// by the waves of the water mesh. The reflection probes (reflection.ts) are L2 and can only give a
// soft sheen. This renders the scene once more from the camera mirrored in the water plane, into
// a linear half-float target like the main pass (hdrOutput.ts), with the near plane replaced by
// the water plane (Lengyel's oblique projection, as three's Reflector), so nothing under the
// water is drawn. The water surface samples it (waterEffects.ts).
//
// The mirrored camera is below the water: refraction.ts only moves vertices for a camera above
// it, and those vertices are clipped anyway. The pass is skipped when the surface is outside the
// view or the camera is not above the water.
//
// To keep the second pass cheap, its frustum is cut down to the surface's rectangle on screen
// (plus a margin for the ripples), drawn into the corner of the target at the same pixel density,
// and the image is kept while nothing it shows changes (the camera, the size and the caller's
// state: lighting, quality). Animated surfaces in the reflection (the water cascade) do not
// move while the view is still.

export interface PlanarReflectionUniforms {
  suiMirror: { value: THREE.Texture | null };
  /** World position to texture coordinates of the mirror image. */
  suiMirrorMatrix: { value: THREE.Matrix4 };
  /** Texture coordinates beyond which the target holds no image. */
  suiMirrorLimit: { value: THREE.Vector2 };
  /** 1 while the mirror holds this frame's reflection, else 0 (the water uses the probes). */
  suiMirrorAmount: { value: number };
}

export const createMirrorUniforms = (): PlanarReflectionUniforms => ({
  suiMirror: { value: null },
  suiMirrorMatrix: { value: new THREE.Matrix4() },
  suiMirrorLimit: { value: new THREE.Vector2(1, 1) },
  suiMirrorAmount: { value: 0 },
});

/** The layer that only the mirror's camera renders, besides the default one (glossyLights.ts). */
export const MIRROR_LAYER = 3;

/** Reflection in the horizontal plane y = level. */
export function mirrorMatrix(level: number) {
  return new THREE.Matrix4().set(1, 0, 0, 0, 0, -1, 0, 2 * level, 0, 0, 1, 0, 0, 0, 0, 1);
}

/**
 * Replaces the near plane of `projection` by `plane` (view space, kept side positive) so that the
 * depth range still ends at the far plane (Lengyel, "Oblique View Frustum Depth Projection and
 * Clipping", 2005). Perspective projections only, including off-center ones.
 */
export function obliqueClip(projection: THREE.Matrix4, plane: THREE.Vector4) {
  const e = projection.elements;
  const q = new THREE.Vector4(
    (Math.sign(plane.x) + e[8]) / e[0],
    (Math.sign(plane.y) + e[9]) / e[5],
    -1,
    (1 + e[10]) / e[14],
  );
  const c = plane.clone().multiplyScalar(2 / plane.dot(q));
  e[2] = c.x;
  e[6] = c.y;
  e[10] = c.z + 1;
  e[14] = c.w;
  return projection;
}

/** Margin around the surface's rectangle, in normalized device units, for the rippled lookups. */
export const MIRROR_MARGIN = 0.08;

/**
 * The part of normalized device space where `corners` (clip space, a convex polygon) appear,
 * clipped to the view and grown by `margin`, as [minX, minY, maxX, maxY]; null if none.
 */
export function screenBounds(corners: THREE.Vector4[], margin = MIRROR_MARGIN) {
  // Clip against w > ε (points behind the camera) before dividing.
  const near = 1e-4;
  const kept: THREE.Vector4[] = [];
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % corners.length];
    if (a.w > near) kept.push(a);
    if (a.w > near !== b.w > near) kept.push(a.clone().lerp(b, (near - a.w) / (b.w - a.w)));
  });
  if (kept.length < 3) return null;
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of kept) {
    box[0] = Math.min(box[0], p.x / p.w);
    box[1] = Math.min(box[1], p.y / p.w);
    box[2] = Math.max(box[2], p.x / p.w);
    box[3] = Math.max(box[3], p.y / p.w);
  }
  const bounds = [
    Math.max(-1, box[0] - margin),
    Math.max(-1, box[1] - margin),
    Math.min(1, box[2] + margin),
    Math.min(1, box[3] + margin),
  ];
  return bounds[0] < bounds[2] && bounds[1] < bounds[3] ? bounds : null;
}

// Maps clip space to texture coordinates.
const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
// Mirroring flips handedness; flipping the camera's x back keeps it a rotation, so faces keep
// their winding (the image is left-right mirrored, which the texture matrix undoes).
const FLIP_X = new THREE.Matrix4().makeScale(-1, 1, 1);

export function createPlanarReflection(
  renderer: THREE.WebGLRenderer,
  level: number,
  uniforms: PlanarReflectionUniforms,
) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  uniforms.suiMirror.value = target.texture;
  const camera = new THREE.PerspectiveCamera();
  camera.layers.enable(MIRROR_LAYER);
  camera.matrixAutoUpdate = false;
  camera.matrixWorldAutoUpdate = false;
  const mirror = mirrorMatrix(level);
  const frustum = new THREE.Frustum();
  // The flat surface's box: its bounding sphere reaches 2 m above the water.
  const bounds = new THREE.Box3();
  const matrix = new THREE.Matrix4();
  const crop = new THREE.Matrix4();
  const plane = new THREE.Vector4();
  const worldPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -level);
  const corners = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
  const size = new THREE.Vector2();
  const stats: RenderStats & { rendered: boolean } = { calls: 0, triangles: 0, rendered: false };
  let scale = 0;
  // What the kept image was drawn for; empty when there is none.
  let drawn: number[] = [];
  return {
    /** Fraction of the drawing buffer's resolution; 0 turns the mirror off and frees its target. */
    setScale(next: number) {
      scale = next;
      drawn = [];
      if (scale <= 0) {
        uniforms.suiMirrorAmount.value = 0;
        // Reallocated by the next render after turning it on again.
        target.dispose();
      }
    },
    /**
     * Renders the mirror for `view` unless `surface` is out of sight, or keeps the last image when
     * `view`, the size and `state` are unchanged. Returns the counts of the last rendered pass.
     */
    render(scene: THREE.Scene, view: THREE.PerspectiveCamera, surface: THREE.Mesh, state: readonly number[] = []) {
      stats.rendered = false;
      uniforms.suiMirrorAmount.value = 0;
      view.updateMatrixWorld();
      matrix.multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse);
      frustum.setFromProjectionMatrix(matrix);
      if (
        scale <= 0 ||
        view.matrixWorld.elements[13] <= level + 0.01 ||
        !frustum.intersectsBox(bounds.setFromObject(surface))
      ) {
        drawn = [];
        stats.calls = stats.triangles = 0;
        return stats;
      }
      renderer.getDrawingBufferSize(size);
      const width = Math.max(1, Math.round(size.x * scale));
      const height = Math.max(1, Math.round(size.y * scale));
      const key = [...view.matrixWorld.elements, ...view.projectionMatrix.elements, width, height, ...state];
      uniforms.suiMirrorAmount.value = 1;
      if (key.length === drawn.length && key.every((value, i) => value === drawn[i])) return stats;
      drawn = key;
      if (target.width !== width || target.height !== height) target.setSize(width, height);

      camera.matrixWorld.multiplyMatrices(mirror, view.matrixWorld).multiply(FLIP_X);
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      camera.far = view.far;
      // Cut the frustum down to the surface: x' = (x − c·w) / h for the rectangle's center c and
      // half size h, rendered into the matching corner of the target.
      matrix.multiplyMatrices(view.projectionMatrix, camera.matrixWorldInverse);
      if (!surface.geometry.boundingBox) surface.geometry.computeBoundingBox();
      const box = surface.geometry.boundingBox!;
      [
        [box.min.x, box.min.y],
        [box.max.x, box.min.y],
        [box.max.x, box.max.y],
        [box.min.x, box.max.y],
      ].forEach(([x, y], i) => corners[i].set(x, y, 0, 1).applyMatrix4(surface.matrixWorld).applyMatrix4(matrix));
      const rectangle = screenBounds(corners) ?? [-1, -1, 1, 1];
      const half = [(rectangle[2] - rectangle[0]) / 2, (rectangle[3] - rectangle[1]) / 2];
      const center = [(rectangle[2] + rectangle[0]) / 2, (rectangle[3] + rectangle[1]) / 2];
      crop.set(
        1 / half[0],
        0,
        0,
        -center[0] / half[0],
        0,
        1 / half[1],
        0,
        -center[1] / half[1],
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
      );
      camera.projectionMatrix.multiplyMatrices(crop, view.projectionMatrix);
      const pixels = [Math.max(1, Math.ceil(half[0] * width)), Math.max(1, Math.ceil(half[1] * height))];
      // The viewport alone bounds the drawing; the clear covers the whole target. A scissor test
      // on this multisampled target stopped all frames in Chrome 154 (ANGLE/Metal, macOS).
      target.viewport.set(0, 0, pixels[0], pixels[1]);
      const limit = uniforms.suiMirrorLimit.value.set(pixels[0] / width, pixels[1] / height);
      uniforms.suiMirrorMatrix.value
        .makeScale(limit.x, limit.y, 1)
        .multiply(BIAS)
        .multiply(camera.projectionMatrix)
        .multiply(camera.matrixWorldInverse);
      // Keep lookups half a texel inside the image.
      limit.x -= 0.5 / width;
      limit.y -= 0.5 / height;
      const local = worldPlane.clone().applyMatrix4(camera.matrixWorldInverse);
      obliqueClip(camera.projectionMatrix, plane.set(local.normal.x, local.normal.y, local.normal.z, local.constant));
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

      const visible = surface.visible;
      surface.visible = false;
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      stats.calls = renderer.info.render.calls;
      stats.triangles = renderer.info.render.triangles;
      stats.rendered = true;
      renderer.setRenderTarget(previous);
      surface.visible = visible;
      return stats;
    },
    get size() {
      return scale > 0 ? `${target.width}x${target.height}` : '0x0';
    },
    dispose() {
      target.dispose();
      drawn = [];
      uniforms.suiMirror.value = null;
      uniforms.suiMirrorAmount.value = 0;
    },
  };
}
export type PlanarReflection = ReturnType<typeof createPlanarReflection>;
