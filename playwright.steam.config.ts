import { defineConfig } from '@playwright/test';
import gpu from './playwright.gpu.config';

// The room's steam and the heat haze (steam-haze.gpu.ts). STEAM_BASELINE_DIST serves the build
// before them; STEAM_RUN labels the run (its own output folder).
const baseline = process.env.STEAM_BASELINE_DIST;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
// A single config object replaces the server; defineConfig(base, overrides) concatenates servers.
export default defineConfig({
  ...gpu,
  testMatch: '**/steam-haze.gpu.ts',
  outputDir: `test-results/steam-${process.env.STEAM_RUN ?? 'after1'}`,
  use: { ...gpu.use, reducedMotion: 'no-preference' },
  webServer: {
    ...(Array.isArray(gpu.webServer) ? gpu.webServer[0] : gpu.webServer),
    command: `bun run preview -- ${baseline ? `--outDir ${quote(baseline)} ` : ''}--host 127.0.0.1 --port 4175 --strictPort`,
  },
});
