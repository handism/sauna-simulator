import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig(base, {
  testMatch: '**/*.network.ts',
  timeout: 90_000,
  outputDir: 'test-results/network',
  use: { trace: 'off', serviceWorkers: 'block', deviceScaleFactor: 1 },
});
