import { defineConfig } from '@playwright/test';
import gpu from './playwright.gpu.config';
import visual from './playwright.visual.config';
const cost = process.env.CONTACT_COST === '1';
const base = cost ? gpu : visual;

// The contact shadow comparison: stills (contact-shadows.visual.ts) or, with CONTACT_COST=1, frame cost
// (frame-cost.gpu.ts). CONTACT_BASELINE_DIST serves the real pre-change bundle for the before runs.
const baseline = process.env.CONTACT_BASELINE_DIST;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
// A single config object replaces the server; defineConfig(base, overrides) concatenates servers.
export default defineConfig({
  ...base,
  testMatch: cost ? '**/frame-cost.gpu.ts' : '**/contact-shadows.visual.ts',
  outputDir: `test-results/contact-${cost ? 'cost-' : ''}${process.env.CONTACT_RUN ?? 'after1'}`,
  webServer: {
    ...(Array.isArray(base.webServer) ? base.webServer[0] : base.webServer),
    command: `bun run preview -- ${baseline ? `--outDir ${quote(baseline)} ` : ''}--host 127.0.0.1 --port 4175 --strictPort`,
  },
});
