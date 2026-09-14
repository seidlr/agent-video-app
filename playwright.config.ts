import { defineConfig, devices } from '@playwright/test';

// Chromium only: WebCodecs/WebGPU/OPFS/document.modelContext polyfill all need Chromium.
// ML (@ml-tagged) scenarios default to wasm in CI; run with --grep @ml locally on WebGPU too.
//
// channel:'chrome' runs real Google Chrome, not Playwright's bundled open-source Chromium --
// the latter ships without H.264/AAC decode support (licensing), so every sample/fixture video
// in this app (all H.264+AAC mp4, per the plan's Global Constraints) fails with
// DEMUXER_ERROR_NO_SUPPORTED_STREAMS and playback silently never advances past currentTime:0.
// Confirmed empirically while writing tests/e2e/player.spec.ts. Install via
// `npx playwright install chrome` (downloads real Chrome on CI; reuses the system install
// locally when present).
export default defineConfig({
  testDir: '.',
  testMatch: ['tests/e2e/**/*.spec.ts', 'tests/unit/opfs.test.ts', 'server/test/**/*.test.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 3000',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        launchOptions: {
          args: ['--enable-unsafe-webgpu', '--enable-features=SharedArrayBuffer'],
        },
      },
    },
  ],
});
