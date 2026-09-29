import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig(base, {
  testMatch: '**/*.motion.ts',
  timeout: 300_000,
  outputDir: 'test-results/motion',
  use: {
    trace: 'off',
    reducedMotion: 'no-preference',
    video: { mode: 'on', size: { width: 1280, height: 800 } },
  },
});
