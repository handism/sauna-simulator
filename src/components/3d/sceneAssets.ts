import type { AmbientEnv } from '../../hooks/useAudioEngine';
import type { IrradianceHeader } from './irradiance';
import type { WaterDefinition } from './waterEffects';

/** public/models/sauna.scene.json, written by scripts/export_web_glb.py. */
export interface SceneDefinition {
  views: Record<AmbientEnv, { position: number[]; target: number[]; fov: number }>;
  stove: number[];
  water: WaterDefinition;
}

export interface ProbeData {
  header: IrradianceHeader;
  buffer: ArrayBuffer;
}

export const MODEL_BASE = `${import.meta.env.BASE_URL}models/`;

/** Fetches a file of public/models/; a failed response throws. */
export function createModelFetch(signal: AbortSignal) {
  return (name: string) =>
    fetch(`${MODEL_BASE}${name}`, { signal }).then((response) => {
      if (!response.ok) throw Error(name);
      return response;
    });
}

/** Everything the scene needs before it can draw; the garden follows separately. */
export async function fetchSceneAssets(get: ReturnType<typeof createModelFetch>) {
  const [definition, model, irradianceHeader, irradianceBuffer, reflectionHeader, reflectionBuffer]: [
    SceneDefinition,
    ArrayBuffer,
    IrradianceHeader,
    ArrayBuffer,
    IrradianceHeader,
    ArrayBuffer,
  ] = await Promise.all([
    get('sauna.scene.json').then((r) => r.json()),
    get('sauna.glb').then((r) => r.arrayBuffer()),
    get('irradiance.json').then((r) => r.json()),
    get('irradiance.bin').then((r) => r.arrayBuffer()),
    get('reflection.json').then((r) => r.json()),
    get('reflection.bin').then((r) => r.arrayBuffer()),
  ]);
  const irradiance: ProbeData = { header: irradianceHeader, buffer: irradianceBuffer };
  const reflection: ProbeData = { header: reflectionHeader, buffer: reflectionBuffer };
  return { definition, model, irradiance, reflection };
}
