export type QualityMode = 'low' | 'standard' | 'high';
// duskLights: the five unshadowed Blue hour accent lights, which cost every lit pixel.
export const QUALITY = {
  low: { pixelRatio: 1, shadowSize: 0, duskLights: false },
  standard: { pixelRatio: 1.5, shadowSize: 1024, duskLights: true },
  high: { pixelRatio: 2, shadowSize: 2048, duskLights: true },
} as const;
