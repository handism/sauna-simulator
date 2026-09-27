import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig(base, {
  testMatch: '**/*.soak.ts',
  // Six full cycles must finish even when a 180-frame window exceeds 15 seconds.
  // Slow windows remain visible in the attachment; this is not an FPS gate.
  timeout: 600_000,
  // Keep the five-minute run separate from routine regression tests.
  outputDir: 'test-results/soak',
  use: { trace: 'off' },
});
