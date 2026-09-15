import { describe, expect, it, vi } from 'vitest';
import { createModelClient, type ClientDeps, type MlWorker } from '../../src/ml/client';
import { getCatalogEntry, type ModelCatalogEntry } from '../../src/ml/catalog';

/** A synthetic two-family catalog (segment + detect) so budget-rejection/eviction tests can
 * exercise a real cross-family scenario without the real catalog's family-exclusivity rule (both
 * real entries are family:'segment') resolving the room for them first. */
const TWO_FAMILY_CATALOG: ModelCatalogEntry[] = [
  { id: 'model-a', task: 'a', repo: 'org/a', dtype: 'fp32', family: 'segment', device: 'webgpu', license: 'Apache-2.0', url: 'https://example.com/a', approxMB: 800 },
  { id: 'model-b', task: 'b', repo: 'org/b', dtype: 'fp32', family: 'detect', device: 'webgpu', license: 'Apache-2.0', url: 'https://example.com/b', approxMB: 800 },
];

function fakeWorker(): MlWorker & { terminated: boolean } {
  const handle = {
    ready: Promise.resolve(),
    call: vi.fn().mockResolvedValue(undefined),
    terminated: false,
    terminate(): void {
      handle.terminated = true;
    },
  };
  return handle;
}

/** A controllable fake of every real network/worker dependency: `cachedIds` decides which models
 * `isPipelineCached` reports as already downloaded, `sizes` is a fixed MB per model id (defaults
 * to each catalog entry's own approxMB), and `createWorker` hands back trackable fake workers. */
function fakeDeps(
  overrides: Partial<{ cachedIds: Set<string>; sizes: Record<string, number>; now: () => number; catalog: ModelCatalogEntry[] }> = {},
): ClientDeps & { workers: Map<string, ReturnType<typeof fakeWorker>[]> } {
  const cachedIds = overrides.cachedIds ?? new Set<string>();
  const sizes = overrides.sizes ?? {};
  const workers = new Map<string, ReturnType<typeof fakeWorker>[]>();
  return {
    workers,
    now: overrides.now,
    catalog: overrides.catalog,
    async isPipelineCached(entry) {
      return cachedIds.has(entry.id);
    },
    async getPipelineSizeMB(entry) {
      return sizes[entry.id] ?? entry.approxMB;
    },
    createWorker(entry) {
      const w = fakeWorker();
      const list = workers.get(entry.id) ?? [];
      list.push(w);
      workers.set(entry.id, list);
      return w;
    },
  };
}

describe('createModelClient', () => {
  it('ensureModel returns unknown_model for an id not in the catalog', async () => {
    const client = createModelClient(fakeDeps());
    const result = await client.ensureModel('nonexistent');
    expect(result).toEqual({ ok: false, error: 'unknown_model' });
  });

  it('DoD: without confirmDownload, an uncached model returns model_not_loaded naming its MB', async () => {
    const client = createModelClient(fakeDeps());
    const result = await client.ensureModel('edgetam');
    expect(result).toMatchObject({ ok: false, error: 'model_not_loaded', sizeMB: getCatalogEntry('edgetam')!.approxMB });
    expect((result as { hint: string }).hint).toContain(`${getCatalogEntry('edgetam')!.approxMB}MB`);
    expect((result as { hint: string }).hint).toContain('confirmDownload:true');
  });

  it('DoD: with confirmDownload, the job completes and the model becomes resident (a second call reuses it)', async () => {
    const deps = fakeDeps();
    const client = createModelClient(deps);

    const first = await client.ensureModel('edgetam', { confirmDownload: true });
    expect(first.ok).toBe(true);
    expect(deps.workers.get('edgetam')).toHaveLength(1);

    const second = await client.ensureModel('edgetam');
    expect(second.ok).toBe(true);
    expect(deps.workers.get('edgetam')).toHaveLength(1); // reused, not recreated

    const rows = await client.listModels();
    expect(rows.find((r) => r.id === 'edgetam')).toMatchObject({ loaded: true, cached: true });
  });

  it('forwards createWorker\'s progress reports to ensureModel\'s onProgress option', async () => {
    const deps: ClientDeps = {
      async isPipelineCached() {
        return false;
      },
      async getPipelineSizeMB(entry) {
        return entry.approxMB;
      },
      createWorker(_entry, onProgress) {
        onProgress(0.5);
        const w = fakeWorker();
        onProgress(1);
        return w;
      },
    };
    const client = createModelClient(deps);
    const reported: number[] = [];

    await client.ensureModel('edgetam', { confirmDownload: true, onProgress: (fraction) => reported.push(fraction) });

    expect(reported).toEqual([0.5, 1]);
  });

  it('an already-cached model does not need confirmDownload', async () => {
    const client = createModelClient(fakeDeps({ cachedIds: new Set(['slimsam']) }));
    const result = await client.ensureModel('slimsam');
    expect(result.ok).toBe(true);
  });

  it('DoD: unloadModel flips loaded back to false and terminates the worker', async () => {
    const deps = fakeDeps();
    const client = createModelClient(deps);
    await client.ensureModel('edgetam', { confirmDownload: true });

    expect(client.unloadModel('edgetam')).toBe(true);
    expect(deps.workers.get('edgetam')?.[0]?.terminated).toBe(true);

    const rows = await client.listModels();
    expect(rows.find((r) => r.id === 'edgetam')).toMatchObject({ loaded: false, residentMB: 0 });
  });

  it('unloadModel on a model that was never loaded is a no-op returning false', async () => {
    const client = createModelClient(fakeDeps());
    expect(client.unloadModel('edgetam')).toBe(false);
  });

  it('at most one resident model per family: loading a second segmentation model evicts the first', async () => {
    const deps = fakeDeps();
    const client = createModelClient(deps);
    await client.ensureModel('edgetam', { confirmDownload: true });
    await client.ensureModel('slimsam', { confirmDownload: true });

    expect(deps.workers.get('edgetam')?.[0]?.terminated).toBe(true);
    const rows = await client.listModels();
    expect(rows.find((r) => r.id === 'edgetam')).toMatchObject({ loaded: false });
    expect(rows.find((r) => r.id === 'slimsam')).toMatchObject({ loaded: true });
  });

  it('DoD-adjacent: rejects a cross-family load that would exceed the resident budget without evict:true', async () => {
    const deps = fakeDeps({ catalog: TWO_FAMILY_CATALOG });
    const client = createModelClient(deps);
    client.setBudgetMB(1000); // room for exactly one 800MB model, not both

    await client.ensureModel('model-a', { confirmDownload: true });
    const result = await client.ensureModel('model-b', { confirmDownload: true });

    expect(result).toMatchObject({ ok: false, error: 'memory_budget', residentMB: 800, budgetMB: 1000 });
    // The rejected load never evicted or replaced the first model.
    expect(deps.workers.get('model-a')?.[0]?.terminated).toBe(false);
  });

  it('evict:true unloads least-recently-used resident models (cross-family) until a load fits the budget', async () => {
    let clock = 0;
    const deps = fakeDeps({ catalog: TWO_FAMILY_CATALOG, now: () => clock });
    const client = createModelClient(deps);
    client.setBudgetMB(1000);

    clock = 1;
    await client.ensureModel('model-a', { confirmDownload: true });

    clock = 2;
    const result = await client.ensureModel('model-b', { confirmDownload: true, evict: true });

    expect(result.ok).toBe(true);
    expect(deps.workers.get('model-a')?.[0]?.terminated).toBe(true); // evicted to make room
    const rows = await client.listModels();
    expect(rows.find((r) => r.id === 'model-a')).toMatchObject({ loaded: false });
    expect(rows.find((r) => r.id === 'model-b')).toMatchObject({ loaded: true });
  });

  it('DoD: list_models reports every catalog entry with a numeric sizeMB and cached:false on a fresh profile', async () => {
    const client = createModelClient(fakeDeps());
    const rows = await client.listModels();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(typeof row.sizeMB).toBe('number');
      expect(row.sizeMB).toBeGreaterThan(0);
      expect(row.cached).toBe(false);
      expect(row.loaded).toBe(false);
    }
  });

  it('memoizes getPipelineSizeMB per model across repeated calls', async () => {
    const getPipelineSizeMB = vi.fn().mockResolvedValue(42);
    const deps = fakeDeps();
    const client = createModelClient({ ...deps, getPipelineSizeMB });

    await client.listModels();
    await client.listModels();
    await client.ensureModel('edgetam');

    const edgetamCalls = getPipelineSizeMB.mock.calls.filter(([entry]) => entry.id === 'edgetam');
    expect(edgetamCalls).toHaveLength(1);
  });
});
