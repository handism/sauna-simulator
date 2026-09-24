export type QualityMode = 'low' | 'standard' | 'high';
// duskLights: the five Blue hour accent lights, which cost every lit pixel. mirror: resolution of
// the water's planar reflection relative to the drawing buffer (0: the reflection probes only).
export const QUALITY = {
  low: { pixelRatio: 1, shadowSize: 0, duskLights: false, mirror: 0 },
  standard: { pixelRatio: 1.5, shadowSize: 1024, duskLights: true, mirror: 0.5 },
  high: { pixelRatio: 2, shadowSize: 2048, duskLights: true, mirror: 1 },
} as const;
