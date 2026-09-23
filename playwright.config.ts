import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 90_000,
  workers: 1,
  use: {
    channel: 'chrome',
    baseURL: 'http://127.0.0.1:4175/sauna-simulator/',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'bun run preview -- --host 127.0.0.1 --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175/sauna-simulator/',
    reuseExistingServer: false,
  },
});
