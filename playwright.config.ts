import { defineConfig, devices } from '@playwright/test';

// Chromium only: WebCodecs/WebGPU/OPFS/document.modelContext polyfill all need Chromium.
// ML (@ml-tagged) scenarios default to wasm in CI; run with --grep @ml locally on WebGPU too.
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
        launchOptions: {
          args: ['--enable-unsafe-webgpu', '--enable-features=SharedArrayBuffer'],
        },
      },
    },
  ],
});
