import { defineConfig } from '@playwright/test';
import gpu from './playwright.gpu.config';
import visual from './playwright.visual.config';
const cost = process.env.GROUND_COST === '1';
const base = cost ? gpu : visual;

// The stones/meadow comparison: stills (stones-meadow.visual.ts) or, with GROUND_COST=1, frame cost
// (frame-cost.gpu.ts). GROUND_BASELINE_DIST serves the real pre-change bundle for the before runs.
const baseline = process.env.GROUND_BASELINE_DIST;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
// A single config object replaces the server; defineConfig(base, overrides) concatenates servers.
export default defineConfig({
  ...base,
  testMatch: cost ? '**/frame-cost.gpu.ts' : '**/stones-meadow.visual.ts',
  outputDir: `test-results/ground-${cost ? 'cost-' : ''}${process.env.GROUND_RUN ?? 'after1'}`,
  webServer: {
    ...(Array.isArray(base.webServer) ? base.webServer[0] : base.webServer),
    command: `bun run preview -- ${baseline ? `--outDir ${quote(baseline)} ` : ''}--host 127.0.0.1 --port 4175 --strictPort`,
  },
});
