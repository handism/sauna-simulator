import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig(base, {
  testMatch: '**/*.soak.ts',
  timeout: 420_000,
  // Keep the five-minute run separate from routine regression tests.
  outputDir: 'test-results/soak',
  use: { trace: 'off' },
});
