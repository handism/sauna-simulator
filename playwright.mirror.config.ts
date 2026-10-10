import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const browserName = process.env.MIRROR_BROWSER ?? 'chromium';
if (browserName !== 'chromium' && browserName !== 'webkit') throw Error('Invalid MIRROR_BROWSER');

export default defineConfig(base, {
  testMatch: '**/mirror-steps.visual.ts',
  timeout: 240_000,
  outputDir: `test-results/mirror-${browserName}`,
  use: {
    browserName,
    channel: browserName === 'chromium' ? 'chrome' : undefined,
    trace: 'off',
    reducedMotion: 'no-preference',
  },
});
