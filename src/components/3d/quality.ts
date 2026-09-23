export type QualityMode = 'low' | 'standard' | 'high';
export const QUALITY = {
  low: { pixelRatio: 1, shadowSize: 0 },
  standard: { pixelRatio: 1.5, shadowSize: 1024 },
  high: { pixelRatio: 2, shadowSize: 2048 },
} as const;
