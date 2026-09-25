import { mlClient } from '../../ml/client';
import type { EnsureModelOptions, EnsureModelResult, MlWorker } from '../../ml/client';
import { studioStore } from '../../store/studio';
import type { ModelState } from '../../store/studio';

/** How long a result/error line stays up next to the control that produced it. Long enough to read
 * a load-failure message (the old 3 s cleared before a human could), short enough not to pile up. */
export const UI_FEEDBACK_MS = 6000;

export type UiEnsureResult =
  | { ok: true; worker: MlWorker }
  | { ok: false; needsConfirm: true; sizeMB: number }
  | { ok: false; needsConfirm: false; message: string };

export interface UiEnsureDeps {
  client: { ensureModel(id: string, options?: EnsureModelOptions): Promise<EnsureModelResult> };
  setModelState(id: string, patch: Partial<ModelState>): void;
}

/**
 * The one place a human click (SegmentClickLayer, Vision/Transcript/Effects/Frames/Models panels)
 * loads a model. A UI caller bypasses `registry.call`, which is what turns an agent tool's thrown
 * error into `{ok:false, error:'tool_threw...'}` -- so calling `mlClient.ensureModel` directly
 * left every failure invisible: a rejected worker load (offline, blocked CDN, WebGPU/ORT error)
 * became an unhandled rejection, and `memory_budget`/`unknown_model` returned quietly, so a click
 * on "Download" appeared to do nothing. This never throws and reports every outcome:
 * `needsConfirm` (show the size prompt), `message` (show it), or a ready worker. Download progress
 * is published to `models[id].progress`, which SizeConfirm renders.
 */
export async function ensureModelCore(modelId: string, options: { confirmDownload: boolean; evict?: boolean }, deps: UiEnsureDeps): Promise<UiEnsureResult> {
  deps.setModelState(modelId, { progress: 0 });
  try {
    const result = await deps.client.ensureModel(modelId, {
      confirmDownload: options.confirmDownload,
      evict: options.evict,
      // A worker reports 1 only once the model is really loaded (ensureModel resolving then sets it
      // below); an early 1 is just the first small file finishing before the others are counted.
      onProgress: (fraction) => {
        if (fraction < 1) deps.setModelState(modelId, { progress: fraction });
      },
    });
    if (result.ok) {
      deps.setModelState(modelId, { loaded: true, cached: true, progress: 1 });
      return { ok: true, worker: result.worker };
    }
    deps.setModelState(modelId, { progress: 0 });
    switch (result.error) {
      case 'model_not_loaded':
        return { ok: false, needsConfirm: true, sizeMB: result.sizeMB };
      case 'memory_budget':
        return { ok: false, needsConfirm: false, message: result.hint };
      case 'unknown_model':
        return { ok: false, needsConfirm: false, message: `Unknown model "${modelId}"` };
    }
  } catch (error) {
    deps.setModelState(modelId, { progress: 0 });
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, needsConfirm: false, message: `Couldn't load ${modelId}: ${reason}` };
  }
}

export function ensureModelForUi(modelId: string, options: { confirmDownload: boolean; evict?: boolean }): Promise<UiEnsureResult> {
  return ensureModelCore(modelId, options, { client: mlClient, setModelState: studioStore.getState().setModelState });
}
