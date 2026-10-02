export type QualityMode = 'low' | 'standard' | 'high';
// duskLights: the five Blue hour accent lights, which cost every lit pixel. mirror: resolution of
// the water's planar reflection relative to the drawing buffer (0: the reflection probes only).
// temporal: blending with the previous frames while looking around (temporalAA.ts, about 1 ms at
// ratio 1.5).
export const QUALITY = {
  low: { pixelRatio: 1, shadowSize: 0, duskLights: false, mirror: 0, temporal: false },
  standard: { pixelRatio: 1.5, shadowSize: 1024, duskLights: true, mirror: 0.5, temporal: true },
  high: { pixelRatio: 2, shadowSize: 2048, duskLights: true, mirror: 1, temporal: true },
} as const;
