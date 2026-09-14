import { defineConfig } from 'vitest/config';

// Node-only unit tests for pure logic (time parsing, exports, scene math, dHash, registry
// validation, ...). Anything needing real browser APIs (OPFS, WebCodecs, WebGPU) runs under
// Playwright instead — see tests/unit/opfs.test.ts and playwright.config.ts's extra testMatch.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['tests/unit/opfs.test.ts'],
  },
});
