// The probe files (irradiance.bin, reflection.bin) hold the Daylight, Blue hour and Night bakes,
// each grid's scenes as separate blocks (the header's offsets). The browser fetches each scene as
// its own file (models/probes/<kind>-<scene>.bin, the scene's block of every grid in the header's
// order), cut from the shipped files by vite.config.ts, so a slow connection waits only for the
// scenes the time of day shows and the rest follows the ready scene. No three here: vite.config.ts
// imports it.

/** The baked scenes, in the order of the time of day (irradiance.ts SCENES). */
export const PROBE_SCENES = ['day', 'evening', 'night'] as const;
export type ProbeScene = (typeof PROBE_SCENES)[number];
export const PROBE_KINDS = ['irradiance', 'reflection'] as const;
export type ProbeKind = (typeof PROBE_KINDS)[number];

/** What the split needs of a probe header (irradiance.ts IrradianceHeader). */
interface SceneLayout {
  grids: { resolution: number[]; offset: Record<string, number> }[];
}

/** 9 RGB coefficients a probe. */
const COEFFICIENTS = 27;

/** Path under models/ of a scene's file. */
export const probeSceneFile = (kind: ProbeKind, scene: ProbeScene) => `probes/${kind}-${scene}.bin`;

/** The scene's block of each grid in the full file (float16 values), in the header's order. */
function blocks(header: SceneLayout, scene: ProbeScene) {
  return header.grids.map((grid) => ({
    offset: grid.offset[scene],
    length: grid.resolution.reduce((a, b) => a * b) * COEFFICIENTS,
  }));
}

/** A scene's file cut from the full one. */
export function splitProbeScene(header: SceneLayout, values: Uint16Array, scene: ProbeScene) {
  const parts = blocks(header, scene);
  const out = new Uint16Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const { offset, length } of parts) {
    if (offset + length > values.length) throw Error(scene);
    out.set(values.subarray(offset, offset + length), at);
    at += length;
  }
  return out;
}

/** Writes a scene's file back to its place in a full-size buffer; throws on a size mismatch. */
export function placeProbeScene(header: SceneLayout, target: Uint16Array, scene: ProbeScene, file: ArrayBuffer) {
  const parts = blocks(header, scene);
  const values = new Uint16Array(file);
  if (values.length !== parts.reduce((sum, part) => sum + part.length, 0)) throw Error(scene);
  let at = 0;
  for (const { offset, length } of parts) {
    if (offset + length > target.length) throw Error(scene);
    target.set(values.subarray(at, at + length), offset);
    at += length;
  }
}

/** Float16 values of the full file the header describes (the end of its last block). */
export const probeValues = (header: SceneLayout) =>
  Math.max(...PROBE_SCENES.flatMap((scene) => blocks(header, scene).map((part) => part.offset + part.length)));

/**
 * The scenes the lighting passes through moving from one time of day to another (lighting.ts
 * timeOfDay: 0 day, 1 blue hour, 2 night; in between, the two neighbours blend).
 */
export function scenesBetween(from: number, to: number): ProbeScene[] {
  const clamp = (t: number) => Math.min(2, Math.max(0, t));
  const low = Math.floor(clamp(Math.min(from, to)));
  const high = Math.ceil(clamp(Math.max(from, to)));
  return PROBE_SCENES.slice(low, high + 1);
}
