import * as THREE from 'three';
import type { WarmupPass } from './warmupPasses';

/** Internal adapter for Three.js 0.186.0. Revalidate when upgrading Three.js.
 * Call after compiling the current view/configuration, before changing visibility.
 * Missing metadata is an error, never evidence that a material is cheap or prepared.
 */
export function collectWarmupGroups(
  renderer: Pick<THREE.WebGLRenderer, 'properties' | 'getContext'>,
  eligible: ReadonlyMap<THREE.Material, ReadonlySet<WarmupPass>>,
) {
  const gl = renderer.getContext();
  const groups = new Map<string, { materials: THREE.Material[]; passes: Set<WarmupPass> }>();
  const lengths = new Map<object, number>();
  for (const [material, passes] of eligible) {
    if (!material.visible || !passes.size) continue;
    const properties = renderer.properties.get(material) as
      | {
          currentProgram?: { id: number; vertexShader: WebGLShader; fragmentShader: WebGLShader };
        }
      | undefined;
    const program = properties?.currentProgram;
    if (!program || !Number.isInteger(program.id) || !program.vertexShader || !program.fragmentShader)
      throw new Error('Warmup program metadata unavailable');
    let length = lengths.get(program);
    if (length === undefined) {
      const vertex = gl.getShaderSource(program.vertexShader);
      const fragment = gl.getShaderSource(program.fragmentShader);
      if (!vertex || !fragment) throw new Error('Warmup shader source unavailable');
      length = vertex.length + fragment.length;
      lengths.set(program, length);
    }
    if (length <= 60000) continue;
    // Match the diagnostic grouping, additionally separating custom alpha/depth/side states.
    const key = JSON.stringify([
      program.id,
      material.transparent,
      material.blending,
      material.blendSrc,
      material.blendDst,
      material.blendEquation,
      material.blendSrcAlpha,
      material.blendDstAlpha,
      material.blendEquationAlpha,
      material.blendColor.toArray(),
      material.blendAlpha,
      material.premultipliedAlpha,
      material.depthTest,
      material.depthFunc,
      material.depthWrite,
      material.colorWrite,
      material.alphaToCoverage,
      material.side,
      material.forceSinglePass,
      material.polygonOffset,
      material.polygonOffsetFactor,
      material.polygonOffsetUnits,
      material.stencilWrite,
      material.stencilWriteMask,
      material.stencilFunc,
      material.stencilRef,
      material.stencilFuncMask,
      material.stencilFail,
      material.stencilZFail,
      material.stencilZPass,
    ]);
    const group = groups.get(key) ?? { materials: [], passes: new Set<WarmupPass>() };
    group.materials.push(material);
    for (const pass of passes) group.passes.add(pass);
    groups.set(key, group);
  }
  return groups;
}
