import { mlClient } from '../../ml/client';
import type { StudioStore } from '../../store/studio';
import type { Registry, ToolResult } from '../registry';

/** model tools: list_models, load_model, unload_model. All `always` -- model lifecycle has
 * nothing to do with which video source is loaded. Every ML tool from Task 7 onward goes through
 * `mlClient.ensureModel`, which is what makes "on demand, only when the agent asks" (Global
 * Constraints) a guarantee rather than a convention: nothing here or in ml/client.ts ever calls
 * `from_pretrained` at import/page-load time. */
export function defineModelTools(registry: Registry, store: StudioStore): void {
  registry.define({
    name: 'list_models',
    description: 'Lists every model this app can load: size, license, and whether it is cached locally or currently loaded in memory.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    group: 'models',
    when: 'always',
    handler: async (): Promise<ToolResult> => {
      const rows = await mlClient.listModels();
      for (const row of rows) {
        store.getState().setModelState(row.id, { cached: row.cached, loaded: row.loaded, progress: row.loaded ? 1 : 0 });
      }
      return {
        ok: true,
        summary: `${rows.length} model(s) in the catalog, ${rows.filter((r) => r.loaded).length} loaded`,
        models: rows,
        budgetMB: mlClient.getBudgetMB(),
      };
    },
  });

  registry.define<{ id: string; confirmDownload?: boolean }>({
    name: 'load_model',
    description:
      'Downloads (if not already cached) and loads a model into memory, ready for the tools that use it. First call without confirmDownload to see the size; pass confirmDownload:true to actually download.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, confirmDownload: { type: 'boolean' } },
      required: ['id'],
    },
    group: 'models',
    when: 'always',
    mode: 'job',
    handler: async (args): Promise<ToolResult> => {
      const result = await mlClient.ensureModel(args.id, {
        confirmDownload: args.confirmDownload,
        onProgress: (fraction) => store.getState().setModelState(args.id, { progress: fraction }),
      });

      if (!result.ok) {
        if (result.error === 'unknown_model') return { ok: false, error: 'unknown_model', hint: `no model with id "${args.id}"` };
        // model_not_loaded/memory_budget already name every relevant number (MB, budget) in their
        // own hint text (ml/client.ts) -- ToolErrResult has no room for extra structured fields.
        return { ok: false, error: result.error, hint: result.hint };
      }

      store.getState().setModelState(args.id, { loaded: true, cached: true, progress: 1 });
      return { ok: true, summary: `Loaded ${args.id}` };
    },
  });

  registry.define<{ id: string }>({
    name: 'unload_model',
    description: 'Frees a loaded model from memory (GPU buffers/worker terminated).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    group: 'models',
    when: 'always',
    handler: (args): ToolResult => {
      const wasLoaded = mlClient.unloadModel(args.id);
      store.getState().setModelState(args.id, { loaded: false, progress: 0 });
      return { ok: true, summary: wasLoaded ? `Unloaded ${args.id}` : `${args.id} was not loaded` };
    },
  });
}
