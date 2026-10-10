import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const browserName = process.env.VISUAL_BROWSER ?? 'chromium';
if (browserName !== 'chromium' && browserName !== 'webkit') throw Error('Invalid VISUAL_BROWSER');

export default defineConfig(base, {
  testMatch: '**/*.visual.ts',
  timeout: 180_000,
  outputDir: 'test-results/visual',
  use: {
    browserName,
    channel: browserName === 'chromium' ? 'chrome' : undefined,
    trace: 'off',
    reducedMotion: 'reduce',
  },
});
