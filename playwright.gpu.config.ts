import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig(base, {
  testMatch: '**/*.gpu.ts',
  timeout: 180_000,
  // GPU timer measurements, apart from the regression and survey runs.
  outputDir: 'test-results/gpu',
  use: { trace: 'off', reducedMotion: 'reduce' },
});
