import { expect, test } from '@playwright/test';

// Real-browser OPFS test (per plan Task 2 DoD: "Playwright-run browser test or vitest with
// fake-indexeddb + OPFS shim" — OPFS has no jsdom/fake-indexeddb equivalent, so this runs
// against Chromium's actual navigator.storage.getDirectory()).
test('writeFile/readFile/deleteFile round-trip 1 MB byte-identical', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    // @ts-expect-error resolved by the Vite dev server inside the browser, not by this repo's tsc project
    const mod = await import('/src/store/opfs.ts');
    const bytes = new Uint8Array(1024 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    const blob = new Blob([bytes]);

    await mod.writeFile('test/round-trip.bin', blob);
    const file = await mod.readFile('test/round-trip.bin');
    const readBack = new Uint8Array(await file.arrayBuffer());

    let identical = readBack.length === bytes.length;
    if (identical) {
      for (let i = 0; i < bytes.length; i++) {
        if (readBack[i] !== bytes[i]) {
          identical = false;
          break;
        }
      }
    }

    await mod.deleteFile('test/round-trip.bin');
    const listAfterDelete = await mod.list('test');

    return { identical, size: file.size, listAfterDelete };
  });

  expect(result.identical).toBe(true);
  expect(result.size).toBe(1024 * 1024);
  expect(result.listAfterDelete).not.toContain('round-trip.bin');
});
