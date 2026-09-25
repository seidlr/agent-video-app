import { describe, expect, it, vi } from 'vitest';
import type { EnsureModelResult, MlWorker } from '../../src/ml/client';
import { ensureModelCore } from '../../src/components/ui/ensureModel';

const worker: MlWorker = { ready: Promise.resolve(), call: vi.fn(), terminate: vi.fn() };

function harness(ensure: (id: string, options?: { confirmDownload?: boolean; onProgress?(f: number): void }) => Promise<EnsureModelResult>) {
  const states: Array<{ id: string; patch: object }> = [];
  return {
    states,
    deps: { client: { ensureModel: vi.fn(ensure) }, setModelState: (id: string, patch: object) => states.push({ id, patch }) },
  };
}

describe('ensureModelForUi (human-click model loading)', () => {
  it('asks for confirmation, with the size, when the model is not yet downloaded', async () => {
    const { deps } = harness(async () => ({ ok: false, error: 'model_not_loaded', hint: 'h', sizeMB: 31 }));
    expect(await ensureModelCore('edgetam', { confirmDownload: false }, deps)).toEqual({ ok: false, needsConfirm: true, sizeMB: 31 });
  });

  it('turns a rejected load (network/worker failure) into a message instead of throwing', async () => {
    const { deps, states } = harness(async () => {
      throw new Error('Failed to fetch model.onnx');
    });
    const result = await ensureModelCore('edgetam', { confirmDownload: true }, deps);
    expect(result).toMatchObject({ ok: false, needsConfirm: false });
    expect((result as { message: string }).message).toContain('edgetam');
    expect((result as { message: string }).message).toContain('Failed to fetch model.onnx');
    // progress is reset so a stale bar doesn't linger after the failure
    expect(states.at(-1)).toEqual({ id: 'edgetam', patch: { progress: 0 } });
  });

  it('reports a memory-budget refusal and an unknown model as messages, not silent no-ops', async () => {
    const budget = harness(async () => ({ ok: false, error: 'memory_budget', hint: 'unload a resident model to fit it', residentMB: 1400, budgetMB: 1500 }));
    expect(await ensureModelCore('m', { confirmDownload: true }, budget.deps)).toEqual({ ok: false, needsConfirm: false, message: 'unload a resident model to fit it' });

    const unknown = harness(async () => ({ ok: false, error: 'unknown_model' }));
    expect(await ensureModelCore('nope', { confirmDownload: true }, unknown.deps)).toMatchObject({ ok: false, needsConfirm: false, message: expect.stringContaining('nope') });
  });

  it('publishes download progress and the loaded state to the store on success', async () => {
    const { deps, states } = harness(async (_id, options) => {
      options?.onProgress?.(0.25);
      options?.onProgress?.(0.9);
      return { ok: true, worker };
    });
    const result = await ensureModelCore('edgetam', { confirmDownload: true }, deps);
    expect(result).toEqual({ ok: true, worker });
    expect(states.map((s) => s.patch)).toEqual([{ progress: 0 }, { progress: 0.25 }, { progress: 0.9 }, { loaded: true, cached: true, progress: 1 }]);
  });

  it('ignores an in-flight "100%" (the first small file finishing before the rest are counted); only success sets it', async () => {
    const { deps, states } = harness(async (_id, options) => {
      options?.onProgress?.(1);
      options?.onProgress?.(0.06);
      return { ok: true, worker };
    });
    await ensureModelCore('edgetam', { confirmDownload: true }, deps);
    expect(states.map((s) => s.patch)).toEqual([{ progress: 0 }, { progress: 0.06 }, { loaded: true, cached: true, progress: 1 }]);
  });
});
