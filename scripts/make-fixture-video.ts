// Generates tests/fixtures/cuts.mp4 (see scripts/fixture-gen-client.ts for the actual encode,
// which needs WebCodecs and therefore a real browser). Run with `npm run make-fixture`. The
// output is committed so CI never needs to regenerate it.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_PATH = path.join(ROOT, 'tests/fixtures/cuts.mp4');

// This file runs under Node (tsconfig.node.json, no DOM lib), but the two callbacks below run
// inside the browser page (Playwright serializes them and evaluates them there), where
// `window.__fixtureResult` is the global fixture-gen-client.ts sets. Read it via `globalThis`
// with a local type so this file's own TS project doesn't need the DOM lib for one property.
type FixtureResult = { ok: true; base64: string } | { ok: false; error: string };
function readFixtureResult(): FixtureResult | undefined {
  return (globalThis as unknown as { __fixtureResult?: FixtureResult }).__fixtureResult;
}

async function main(): Promise<void> {
  const server = await createServer({ root: ROOT, server: { port: 0 } });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : null;
  if (!port) throw new Error('Vite dev server did not report a port');
  const base = `http://localhost:${port}`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.on('console', (msg) => console.log(`[browser] ${msg.text()}`));
    page.on('pageerror', (err) => console.error('[browser error]', err));

    await page.goto(`${base}/scripts/fixture-gen.html`);
    await page.waitForFunction(readFixtureResult, undefined, { timeout: 60_000 });

    const result = await page.evaluate(readFixtureResult);
    if (!result) throw new Error('No result reported by fixture-gen-client');
    if (!result.ok) throw new Error(`Fixture generation failed in-browser:\n${result.error}`);

    const bytes = Buffer.from(result.base64, 'base64');
    await mkdir(path.dirname(OUT_PATH), { recursive: true });
    await writeFile(OUT_PATH, bytes);
    console.log(`Wrote ${OUT_PATH} (${(bytes.length / 1024).toFixed(1)} KB)`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
