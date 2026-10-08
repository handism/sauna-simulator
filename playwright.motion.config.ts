import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const browserName = process.env.MOTION_BROWSER ?? 'chromium';
if (browserName !== 'chromium' && browserName !== 'webkit') throw Error('Invalid MOTION_BROWSER');

export default defineConfig(base, {
  testMatch: '**/*.motion.ts',
  timeout: 300_000,
  outputDir: 'test-results/motion',
  use: {
    browserName,
    channel: browserName === 'chromium' ? 'chrome' : undefined,
    trace: 'off',
    reducedMotion: 'no-preference',
    video: { mode: 'on', size: { width: 1280, height: 800 } },
  },
});
