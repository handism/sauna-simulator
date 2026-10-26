import type { AmbientEnv } from '../../hooks/useAudioEngine';
import type { IrradianceHeader } from './irradiance';
import type { WaterDefinition } from './waterEffects';
import type { DeckIrradianceHeader } from './deckIrradiance';
import type { RoomIrradianceHeader } from './roomIrradiance';
import {
  PROBE_SCENES,
  placeProbeScene,
  probeSceneFile,
  probeValues,
  type ProbeKind,
  type ProbeScene,
} from './probeScenes';

/** public/models/sauna.scene.json, written by scripts/export_web_glb.py. */
export interface SceneDefinition {
  views: Record<AmbientEnv, { position: number[]; target: number[]; fov: number }>;
  stageViews?: Partial<SceneDefinition['views']>;
  stove: number[];
  water: WaterDefinition;
}

export interface ProbeData {
  header: IrradianceHeader;
  buffer: ArrayBuffer;
}

export const MODEL_BASE = `${import.meta.env.BASE_URL}models/`;

/**
 * Fetches a file of public/models/; a failed response throws. onProgress hears each piece of a
 * body as it arrives (the load's deadline counts from the last one, SceneMode.tsx).
 */
export function createModelFetch(signal: AbortSignal, onProgress?: () => void) {
  return (name: string) =>
    fetch(`${MODEL_BASE}${name}`, { signal }).then((response) => {
      if (!response.ok) throw Error(name);
      if (!onProgress || !response.body) return response;
      onProgress();
      const counted = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          onProgress();
          controller.enqueue(chunk);
        },
      });
      return new Response(response.body.pipeThrough(counted), {
        status: response.status,
        headers: response.headers,
      });
    });
}

/**
 * Full-size buffers of both probe files that the scenes fill as their files arrive (probeScenes.ts);
 * a scene not yet fetched reads as zero, so the lighting must not weigh it (SaunaScene.tsx).
 */
export function createProbeFiles(irradiance: IrradianceHeader, reflection: IrradianceHeader) {
  const headers: Record<ProbeKind, IrradianceHeader> = { irradiance, reflection };
  const values = {
    irradiance: new Uint16Array(probeValues(irradiance)),
    reflection: new Uint16Array(probeValues(reflection)),
  };
  const loaded = new Set<ProbeScene>();
  return {
    irradiance: { header: irradiance, buffer: values.irradiance.buffer } as ProbeData,
    reflection: { header: reflection, buffer: values.reflection.buffer } as ProbeData,
    loaded: loaded as ReadonlySet<ProbeScene>,
    /** Fetches the scenes not yet loaded of these; throws on a failed fetch or a size mismatch. */
    async fetch(get: ReturnType<typeof createModelFetch>, scenes: readonly ProbeScene[]) {
      const missing = scenes.filter((scene) => !loaded.has(scene));
      const files = await Promise.all(
        missing.flatMap((scene) =>
          (['irradiance', 'reflection'] as const).map((kind) =>
            get(probeSceneFile(kind, scene))
              .then((r) => r.arrayBuffer())
              .then((file) => ({ kind, scene, file })),
          ),
        ),
      );
      for (const { kind, scene, file } of files) placeProbeScene(headers[kind], values[kind], scene, file);
      for (const scene of missing) loaded.add(scene);
      return missing.length;
    },
  };
}
export type ProbeFiles = ReturnType<typeof createProbeFiles>;

/**
 * Everything the scene needs before it can draw, with the probes of the given scenes only; the
 * other scenes (ProbeFiles.fetch) and the garden follow separately.
 */
export async function fetchSceneAssets(
  get: ReturnType<typeof createModelFetch>,
  scenes: readonly ProbeScene[] = PROBE_SCENES,
) {
  // The headers come first (a few hundred bytes): the scenes' files are cut along them.
  const probeHeaders = Promise.all([
    get('irradiance.json').then((r) => r.json() as Promise<IrradianceHeader>),
    get('reflection.json').then((r) => r.json() as Promise<IrradianceHeader>),
  ]).then(async ([irradiance, reflection]) => {
    const probes = createProbeFiles(irradiance, reflection);
    await probes.fetch(get, scenes);
    return probes;
  });
  const [definition, model, probes, deckHeader, deckBuffer, roomHeader, roomBuffer]: [
    SceneDefinition,
    ArrayBuffer,
    ProbeFiles,
    DeckIrradianceHeader,
    ArrayBuffer,
    RoomIrradianceHeader,
    ArrayBuffer,
  ] = await Promise.all([
    get('sauna.scene.json').then((r) => r.json()),
    get('sauna.glb').then((r) => r.arrayBuffer()),
    probeHeaders,
    get('deck-irradiance.json').then((r) => r.json()),
    get('deck-irradiance.bin').then((r) => r.arrayBuffer()),
    get('room-irradiance.json').then((r) => r.json()),
    get('room-irradiance.bin').then((r) => r.arrayBuffer()),
  ]);
  return {
    definition,
    model,
    probes,
    deck: { header: deckHeader, buffer: deckBuffer },
    room: { header: roomHeader, buffer: roomBuffer },
  };
}
