import { ModelRegistry } from '@huggingface/transformers';
import { detectCapabilities } from '../lib/capabilities';
import { MODEL_CATALOG, type ModelCatalogEntry, type ModelDevice } from './catalog';

/** One live model instance -- a thin wrapper the real implementation backs with a Worker, and
 * tests back with a fake. `ready` resolves once the model has actually finished loading in the
 * worker (not just once the worker process exists), so a failed load never gets marked resident. */
export interface MlWorker {
  ready: Promise<void>;
  call<TResult = unknown>(method: string, args?: unknown): Promise<TResult>;
  terminate(): void;
}

export interface ClientDeps {
  /** `ModelRegistry.is_pipeline_cached(entry.task, entry.repo, {dtype: entry.dtype, device:
   * entry.device})` in production. */
  isPipelineCached(entry: ModelCatalogEntry): Promise<boolean>;
  /** Sums `ModelRegistry.get_file_metadata` over `ModelRegistry.get_pipeline_files(...)` in
   * production; `client.ts` memoizes the result per entry regardless, per the plan's Key
   * Decisions, so a slow real implementation is only ever paid once per model per session. */
  getPipelineSizeMB(entry: ModelCatalogEntry): Promise<number>;
  /** Spawns the actual `Worker` (one per model family) and starts loading `entry` into it,
   * reporting fractional progress via `onProgress` as it downloads. */
  createWorker(entry: ModelCatalogEntry, onProgress: (fraction: number) => void): MlWorker;
  /** Injectable clock for deterministic LRU-eviction-order tests. */
  now?(): number;
  /** Defaults to the real MODEL_CATALOG; overridable so tests can exercise multi-family budget
   * scenarios without adding synthetic entries to the production catalog. */
  catalog?: ModelCatalogEntry[];
}

export type EnsureModelResult =
  | { ok: true; worker: MlWorker }
  | { ok: false; error: 'unknown_model' }
  | { ok: false; error: 'model_not_loaded'; hint: string; sizeMB: number }
  | { ok: false; error: 'memory_budget'; hint: string; residentMB: number; budgetMB: number };

export interface EnsureModelOptions {
  confirmDownload?: boolean;
  /** Unload least-recently-used resident models (in any family) until `entry` fits the budget,
   * instead of failing with `memory_budget`. */
  evict?: boolean;
  /** Called with the download/load fraction (0-1) while a new model is loading. Not called at all
   * when the model was already resident (nothing to report). */
  onProgress?(fraction: number): void;
}

export interface ModelListRow {
  id: string;
  family: string;
  license: string;
  sizeMB: number;
  cached: boolean;
  loaded: boolean;
  residentMB: number;
}

export interface ModelClient {
  ensureModel(id: string, options?: EnsureModelOptions): Promise<EnsureModelResult>;
  /** Returns false when `id` wasn't resident (a no-op, not an error -- `unload_model` on an
   * already-unloaded model is a reasonable, idempotent thing for an agent to call). */
  unloadModel(id: string): boolean;
  listModels(): Promise<ModelListRow[]>;
  getBudgetMB(): number;
  setBudgetMB(mb: number): void;
}

/** Every catalog entry's `approxMB` summed would be well under this; it exists to bound how much
 * GPU/wasm memory this app ever holds resident at once, not to allow loading "everything". The
 * plan's `?mlBudget=` query param overrides it per session (wired in the default deps, not here). */
const DEFAULT_BUDGET_MB = 1500;

interface ResidentEntry {
  entry: ModelCatalogEntry;
  worker: MlWorker;
  sizeMB: number;
  lastUsed: number;
}

/**
 * Model lifecycle: cache/size checks, the confirmDownload gate, at-most-one-resident-model-per-
 * family, and a global resident-memory budget with LRU eviction -- the whole of the plan's Key
 * Decisions for `client.ts`, independent of transformers.js/Worker/real-network specifics via the
 * injected `ClientDeps`, so it's fully unit-testable (tests/unit/ml-client.test.ts) without ever
 * downloading a real model.
 */
export function createModelClient(deps: ClientDeps): ModelClient {
  const resident = new Map<string, ResidentEntry>();
  const sizeCache = new Map<string, number>();
  const now = deps.now ?? ((): number => Date.now());
  const catalog = deps.catalog ?? MODEL_CATALOG;
  let budgetMB = DEFAULT_BUDGET_MB;

  async function sizeOf(entry: ModelCatalogEntry): Promise<number> {
    const cached = sizeCache.get(entry.id);
    if (cached !== undefined) return cached;
    const mb = await deps.getPipelineSizeMB(entry);
    sizeCache.set(entry.id, mb);
    return mb;
  }

  function residentTotalMB(): number {
    let total = 0;
    for (const r of resident.values()) total += r.sizeMB;
    return total;
  }

  /** Unloads least-recently-used resident models (any family) until `neededMB` more would fit,
   * or nothing is left to evict. */
  function evictUntilFits(neededMB: number): void {
    const ordered = [...resident.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [id, r] of ordered) {
      if (residentTotalMB() + neededMB <= budgetMB) break;
      r.worker.terminate();
      resident.delete(id);
    }
  }

  async function ensureModel(id: string, options: EnsureModelOptions = {}): Promise<EnsureModelResult> {
    const entry = catalog.find((m) => m.id === id);
    if (!entry) return { ok: false, error: 'unknown_model' };

    const existing = resident.get(id);
    if (existing) {
      existing.lastUsed = now();
      return { ok: true, worker: existing.worker };
    }

    const [cached, sizeMB] = await Promise.all([deps.isPipelineCached(entry), sizeOf(entry)]);
    if (!cached && !options.confirmDownload) {
      return {
        ok: false,
        error: 'model_not_loaded',
        hint: `Call again with confirmDownload:true to download ${sizeMB}MB (${id})`,
        sizeMB,
      };
    }

    // At most one resident model per family -- loading a second segmentation model, say, unloads
    // the first rather than holding both.
    for (const [otherId, r] of resident) {
      if (r.entry.family === entry.family) {
        r.worker.terminate();
        resident.delete(otherId);
      }
    }

    if (residentTotalMB() + sizeMB > budgetMB) {
      if (options.evict) evictUntilFits(sizeMB);
      if (residentTotalMB() + sizeMB > budgetMB) {
        return {
          ok: false,
          error: 'memory_budget',
          hint: `unload a resident model (or pass evict:true) to fit ${id} (${sizeMB}MB) in the ${budgetMB}MB budget`,
          residentMB: residentTotalMB(),
          budgetMB,
        };
      }
    }

    const worker = deps.createWorker(entry, (fraction) => options.onProgress?.(fraction));
    await worker.ready;
    resident.set(id, { entry, worker, sizeMB, lastUsed: now() });
    return { ok: true, worker };
  }

  function unloadModel(id: string): boolean {
    const r = resident.get(id);
    if (!r) return false;
    r.worker.terminate();
    resident.delete(id);
    return true;
  }

  async function listModels(): Promise<ModelListRow[]> {
    return Promise.all(
      catalog.map(async (entry) => {
        const r = resident.get(entry.id);
        const [cached, sizeMB] = await Promise.all([r ? Promise.resolve(true) : deps.isPipelineCached(entry), sizeOf(entry)]);
        return { id: entry.id, family: entry.family, license: entry.license, sizeMB, cached, loaded: !!r, residentMB: r ? sizeMB : 0 };
      }),
    );
  }

  return {
    ensureModel,
    unloadModel,
    listModels,
    getBudgetMB: () => budgetMB,
    setBudgetMB: (mb: number) => {
      budgetMB = mb;
    },
  };
}

interface WorkerRpcMessage {
  id?: string;
  ok?: boolean;
  result?: unknown;
  error?: string;
  type?: 'progress';
  fraction?: number;
}

/** Wraps a real `Worker` (segment.worker.ts today; other model families get their own worker
 * file in later tasks) in the `MlWorker` shape `client.ts` needs: postMessage RPC keyed by an
 * incrementing request id (mirrors agent/jobs.ts's own id-keyed convention, adapted to a Worker
 * boundary), plus unsolicited `{type:'progress'}` messages routed to `onProgress` instead of
 * resolving any pending call. */
function wrapWorker(worker: Worker, onProgress: (fraction: number) => void): { call<T>(method: string, args?: unknown): Promise<T>; terminate(): void } {
  let nextId = 0;
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();

  worker.onmessage = (event: MessageEvent<WorkerRpcMessage>) => {
    const data = event.data;
    if (data.type === 'progress') {
      onProgress(data.fraction ?? 0);
      return;
    }
    if (data.id === undefined) return;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.ok) entry.resolve(data.result);
    else entry.reject(new Error(data.error ?? 'worker_error'));
  };

  function call<T>(method: string, args?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = String(nextId++);
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage({ id, method, args });
    });
  }

  return {
    call,
    terminate(): void {
      worker.terminate();
      for (const { reject } of pending.values()) reject(new Error('worker_terminated'));
      pending.clear();
    },
  };
}

/** One dedicated Worker file per model family (Vite's native `new URL(..., import.meta.url)`
 * worker syntax needs a statically analyzable literal per branch, so this can't be a computed
 * path) -- each new family's worker file gets its own case here the same task that creates it. */
function spawnWorkerForFamily(family: ModelCatalogEntry['family']): Worker {
  switch (family) {
    case 'segment':
      return new Worker(new URL('./segment.worker.ts', import.meta.url), { type: 'module' });
    case 'asr':
      return new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' });
    case 'detect':
      return new Worker(new URL('./detect.worker.ts', import.meta.url), { type: 'module' });
    case 'audio':
      return new Worker(new URL('./audio-events.worker.ts', import.meta.url), { type: 'module' });
    case 'embed':
      return new Worker(new URL('./embed.worker.ts', import.meta.url), { type: 'module' });
    default:
      throw new Error(`no_worker_for_family: ${family} (its worker file doesn't exist yet)`);
  }
}

/** The actual execution backend to load a model with: `entry.device` is only ever `'wasm'` for a
 * model that has no webgpu-capable weights at all (e.g. slimsam), in which case there's nothing to
 * resolve. Everything else resolves live -- WebGPU when the browser actually has it and the
 * `?ml=wasm` escape hatch hasn't forced wasm, wasm otherwise -- so a single catalog id (e.g.
 * Whisper, whose repo/dtype don't vary by backend) still runs on whatever this session can. */
function resolveRuntimeDevice(entry: ModelCatalogEntry): ModelDevice {
  if (entry.device === 'wasm') return 'wasm';
  return detectCapabilities().webgpu && !getMlQueryOverrides().forceWasm ? 'webgpu' : 'wasm';
}

function createWorkerForEntry(entry: ModelCatalogEntry, onProgress: (fraction: number) => void): MlWorker {
  const worker = spawnWorkerForFamily(entry.family);
  const rpc = wrapWorker(worker, onProgress);
  return {
    ready: rpc.call('load', { modelId: entry.id, device: resolveRuntimeDevice(entry) }).then(() => undefined),
    call: rpc.call,
    terminate: rpc.terminate,
  };
}

/** Real `ModelRegistry`-backed deps for production use. `getPipelineSizeMB` falls back to the
 * catalog's own `approxMB` if the live file-metadata lookup can't determine a real size (e.g. hub
 * rate limiting) rather than reporting 0/NaN. */
function createDefaultDeps(): ClientDeps {
  return {
    async isPipelineCached(entry) {
      if (entry.usesPipeline === false) {
        return ModelRegistry.is_cached(entry.repo, { dtype: entry.dtype, device: entry.device });
      }
      return ModelRegistry.is_pipeline_cached(entry.task, entry.repo, { dtype: entry.dtype, device: entry.device });
    },
    async getPipelineSizeMB(entry) {
      try {
        const files =
          entry.usesPipeline === false
            ? await ModelRegistry.get_files(entry.repo, { dtype: entry.dtype, device: entry.device })
            : await ModelRegistry.get_pipeline_files(entry.task, entry.repo, { dtype: entry.dtype, device: entry.device });
        const metas = await Promise.all(files.map((file) => ModelRegistry.get_file_metadata(entry.repo, file)));
        const totalBytes = metas.reduce((sum, meta) => sum + (meta.size ?? 0), 0);
        return totalBytes > 0 ? totalBytes / 1e6 : entry.approxMB;
      } catch {
        return entry.approxMB;
      }
    },
    createWorker: createWorkerForEntry,
  };
}

/** `?ml=wasm` forces the wasm device (Global Constraints' escape hatch for testing/low-end
 * devices without WebGPU); `?mlBudget=<mb>` overrides the default resident-memory budget. Read
 * once per session rather than per call -- this app never expects the URL to change without a
 * full reload. */
export function getMlQueryOverrides(): { forceWasm: boolean; budgetMB: number | null } {
  if (typeof location === 'undefined') return { forceWasm: false, budgetMB: null };
  const params = new URLSearchParams(location.search);
  const budgetParam = params.get('mlBudget');
  const budgetMB = budgetParam ? Number(budgetParam) : null;
  return { forceWasm: params.get('ml') === 'wasm', budgetMB: budgetMB && Number.isFinite(budgetMB) ? budgetMB : null };
}

/** The one shared model client this app uses at runtime -- agent/tools/models.ts and
 * agent/tools/vision.ts both call into this same instance so "at most one resident model per
 * family" and the resident budget are enforced across every tool, not per tool file. */
export const mlClient: ModelClient = createModelClient(createDefaultDeps());

const overrides = getMlQueryOverrides();
if (overrides.budgetMB !== null) mlClient.setBudgetMB(overrides.budgetMB);
