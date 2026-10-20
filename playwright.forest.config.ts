import { defineConfig } from '@playwright/test';
import gpu from './playwright.gpu.config';
import visual from './playwright.visual.config';
const review = process.env.FOREST_REVIEW === 'visual';
const base = review ? visual : gpu;

// Keep the real pre-change bundle, including its original geometry, for whole-change cost.
const baseline = process.env.FOREST_BASELINE_DIST;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
// A single config object replaces the server; defineConfig(base, overrides) concatenates servers.
export default defineConfig({
  ...base,
  testMatch: review
    ? [
        '**/resolution-shimmer.visual.ts',
        '**/forest-back-crowns.visual.ts',
        '**/forest-air.visual.ts',
        '**/forest-leaf-masses.visual.ts',
      ]
    : '**/forest-back-crowns.gpu.ts',
  webServer: {
    ...(Array.isArray(base.webServer) ? base.webServer[0] : base.webServer),
    command: `bun run preview -- ${baseline ? `--outDir ${quote(baseline)} ` : ''}--host 127.0.0.1 --port 4175 --strictPort`,
  },
});
