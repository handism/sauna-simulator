import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig(base, {
  testMatch: '**/*.visual.ts',
  timeout: 180_000,
  outputDir: 'test-results/visual',
  use: { trace: 'off', reducedMotion: 'reduce' },
});
