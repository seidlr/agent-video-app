/**
 * Lazily imports @huggingface/transformers from jsDelivr's ESM CDN instead of a static import.
 * Used from both ML workers (tsconfig.worker.json) and the main-thread ml/client.ts
 * (tsconfig.app.json) -- no WebWorker-only globals here, so it's safe under both lib sets.
 *
 * A static `import ... from '@huggingface/transformers'` in a worker file bundles the whole
 * library -- including its ~60MB onnxruntime-web WASM runtime, base64-inlined -- into that
 * worker's own Rollup chunk. That's fine for the normal multi-file site (each worker chunk is
 * fetched once, lazily, and cached by the browser), but it makes Task 11's MCP App single-file
 * bundle (a real ≤2.5MB DoD) unworkable: confirmed empirically -- building `vite.mcp-app.config.ts`
 * with even one worker statically importing this dependency produced a single 60MB+ worker chunk,
 * and `mcp-app.html` itself came out at ~65MB. jsDelivr's own `+esm` endpoint (verified live:
 * `x-jsd-version: 4.2.0`, CORS-open, ~430KB of glue code with the actual ONNX WASM binary fetched
 * separately at runtime, matching the app's own "on-demand ML model loading only" constraint)
 * moves the entire dependency to a runtime network fetch instead of a build-time bundle, shrinking
 * every worker's own chunk back down to just its own logic.
 *
 * Every worker's former top-level `env.useBrowserCache = true` etc. assignments move here too,
 * since importing this module is now itself async and can only run once (memoized below).
 */
export type TransformersModule = typeof import('@huggingface/transformers');

const TRANSFORMERS_VERSION = '4.2.0';
const TRANSFORMERS_CDN_URL = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}/+esm`;

let modulePromise: Promise<TransformersModule> | null = null;

export function loadTransformers(): Promise<TransformersModule> {
  modulePromise ??= (async (): Promise<TransformersModule> => {
    const mod = (await import(/* @vite-ignore */ TRANSFORMERS_CDN_URL)) as TransformersModule;
    // Per the plan's Key Decisions: cache downloaded model files in the browser's own Cache
    // Storage (survives a reload without re-downloading) under a name scoped to this app, and
    // cache compiled wasm too.
    mod.env.useBrowserCache = true;
    mod.env.cacheKey = 'agent-video-studio-models';
    mod.env.useWasmCache = true;
    return mod;
  })();
  return modulePromise;
}

export interface DownloadProgressEvent {
  status: string;
  loaded?: number;
  total?: number;
}

/**
 * Builds the `progress_callback` every model worker hands to transformers.js, reporting a single
 * 0-1 fraction of the whole download. transformers.js emits a per-file `progress` event (each file
 * counts 0-100% on its own, so a multi-file model's readout jumped 100% -> 26% -> 69% -> 34%...) and,
 * since v4, an aggregate `progress_total` event (bytes loaded/total across every file it will fetch,
 * emitted just before the per-file event it aggregates). Prefer the aggregate; only if a build never
 * emits one fall back to the per-file numbers.
 */
export function downloadProgressCallback(onProgress: (fraction: number) => void): (event: DownloadProgressEvent) => void {
  let sawAggregate = false;
  return (event) => {
    if (event.status === 'progress_total') {
      sawAggregate = true;
      if (event.total) onProgress((event.loaded ?? 0) / event.total);
    } else if (!sawAggregate && event.status === 'progress' && event.total) {
      onProgress((event.loaded ?? 0) / event.total);
    }
  };
}
