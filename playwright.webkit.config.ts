import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Browser-independent lifecycle and shader failure contracts; this is not native Safari.
export default defineConfig(base, {
  testMatch: ['**/scene-lifecycle.e2e.ts', '**/scene-shader.e2e.ts'],
  timeout: 180_000,
  outputDir: 'test-results/webkit',
  use: { browserName: 'webkit', channel: undefined, trace: 'off' },
});
