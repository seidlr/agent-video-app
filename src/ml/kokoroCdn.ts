/**
 * Lazily imports kokoro-js from jsDelivr's ESM CDN instead of a static import -- same reasoning
 * and mechanism as transformersCdn.ts's `loadTransformers`, applied a second time for a genuinely
 * new reason: kokoro-js@1.2.1 hard-depends on its OWN nested `@huggingface/transformers@^3.5.1`
 * copy (confirmed live: `node_modules/kokoro-js/node_modules/@huggingface/transformers` exists,
 * a separate install from this app's own root `@huggingface/transformers@4.2.0`, since npm can't
 * dedupe across major versions) and its published `dist/kokoro.js` statically imports that nested
 * copy at the top of the file. A static `import ... from 'kokoro-js'` in tts.worker.ts would
 * therefore bundle a SECOND ~60MB onnxruntime-web WASM runtime into that worker's own chunk --
 * exactly the single-file MCP App bundle problem transformersCdn.ts already fixed once, reappearing
 * through a different dependency. CDN-loading kokoro-js's own already-built ESM bundle moves that
 * entire nested dependency to a runtime network fetch (jsDelivr's `+esm` endpoint resolves and
 * serves a package's own dependencies as part of one ESM module) instead of a build-time bundle,
 * with no local footprint at all beyond the type-only `import type` below.
 */
export type KokoroModule = typeof import('kokoro-js');

const KOKORO_VERSION = '1.2.1';
const KOKORO_CDN_URL = `https://cdn.jsdelivr.net/npm/kokoro-js@${KOKORO_VERSION}/+esm`;

let modulePromise: Promise<KokoroModule> | null = null;

export function loadKokoro(): Promise<KokoroModule> {
  modulePromise ??= (async (): Promise<KokoroModule> => (await import(/* @vite-ignore */ KOKORO_CDN_URL)) as KokoroModule)();
  return modulePromise;
}
