import { defineConfig } from '@playwright/test';
import visual from './playwright.visual.config';

// The seasonal probe rebake against the calibrated gains alone (season-probes.visual.ts), from the
// same build. SEASON_PROBES_RUN labels the run and its output folder.
export default defineConfig({
  ...visual,
  testMatch: '**/season-probes.visual.ts',
  outputDir: `test-results/season-probes-${process.env.SEASON_PROBES_RUN ?? 'baked1'}`,
});
