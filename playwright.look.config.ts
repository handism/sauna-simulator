import { defineConfig } from '@playwright/test';
import gpu from './playwright.gpu.config';
import visual from './playwright.visual.config';
const cost = process.env.LOOK_COST === '1';
const base = cost ? gpu : visual;

// The 2026-10-22 look fixes comparison: stills (look-fixes.visual.ts) or, with LOOK_COST=1, frame cost
// (frame-cost.gpu.ts). LOOK_BASELINE_DIST serves the real pre-change bundle for the before runs.
const baseline = process.env.LOOK_BASELINE_DIST;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
// A single config object replaces the server; defineConfig(base, overrides) concatenates servers.
export default defineConfig({
  ...base,
  testMatch: cost ? '**/frame-cost.gpu.ts' : '**/look-fixes.visual.ts',
  outputDir: `test-results/look-${cost ? 'cost-' : ''}${process.env.LOOK_RUN ?? 'after1'}`,
  webServer: {
    ...(Array.isArray(base.webServer) ? base.webServer[0] : base.webServer),
    command: `bun run preview -- ${baseline ? `--outDir ${quote(baseline)} ` : ''}--host 127.0.0.1 --port 4175 --strictPort`,
  },
});
