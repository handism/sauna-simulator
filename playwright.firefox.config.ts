import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Keep engine compatibility separate from the Chrome product and GPU diagnostics.
export default defineConfig(base, {
  testMatch: '**/scene-lifecycle.e2e.ts',
  timeout: 180_000,
  outputDir: 'test-results/firefox',
  use: { browserName: 'firefox', channel: undefined, trace: 'off' },
});
