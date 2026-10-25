import { defineConfig } from '@playwright/test';
import gpu from './playwright.gpu.config';
import visual from './playwright.visual.config';
const cost = process.env.GRAPHIC_COST === '1';
const base = cost ? gpu : visual;

// The 2026-10-25 graphic fixes comparison: stills (graphic-fixes.visual.ts) or, with GRAPHIC_COST=1, frame cost
// (frame-cost.gpu.ts). GRAPHIC_BASELINE_DIST serves the real pre-change bundle for the before runs.
const baseline = process.env.GRAPHIC_BASELINE_DIST;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
// A single config object replaces the server; defineConfig(base, overrides) concatenates servers.
export default defineConfig({
  ...base,
  testMatch: cost ? '**/frame-cost.gpu.ts' : '**/graphic-fixes.visual.ts',
  outputDir: `test-results/graphic-${cost ? 'cost-' : ''}${process.env.GRAPHIC_RUN ?? 'after1'}`,
  webServer: {
    ...(Array.isArray(base.webServer) ? base.webServer[0] : base.webServer),
    command: `bun run preview -- ${baseline ? `--outDir ${quote(baseline)} ` : ''}--host 127.0.0.1 --port 4175 --strictPort`,
  },
});
