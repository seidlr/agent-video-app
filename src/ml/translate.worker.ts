/// <reference lib="webworker" />
/**
 * Runs opus-mt translation (Task 13 Key Decisions) in a dedicated Worker, via a real
 * transformers.js `pipeline('translation', ...)`. Loads @huggingface/transformers from the CDN
 * like every other ML worker (transformersCdn.ts). One catalog id per language pair
 * (catalog.ts's `resolveTranslateId`); this worker only ever loads whichever single pair's model
 * the caller already resolved, same as every other family here.
 */
import type { TranslationPipeline } from '@huggingface/transformers';
import { getCatalogEntry, type ModelDevice } from './catalog';
import { loadTransformers } from './transformersCdn';

let translator: TranslationPipeline | null = null;

async function loadModel(modelId: string, device: ModelDevice, onProgress: (fraction: number) => void): Promise<void> {
  const entry = getCatalogEntry(modelId);
  if (!entry) throw new Error(`unknown_model: ${modelId}`);
  const { pipeline } = await loadTransformers();

  const progress_callback = (event: { status: string; loaded?: number; total?: number }): void => {
    if (event.status === 'progress' && event.total) onProgress((event.loaded ?? 0) / event.total);
  };

  translator = await pipeline('translation', entry.repo, {
    device,
    dtype: entry.dtype as Parameters<typeof pipeline>[2] extends { dtype?: infer D } ? D : never,
    progress_callback,
  });
  onProgress(1);
}

interface TranslateResult {
  texts: string[];
}

async function translate(texts: string[]): Promise<TranslateResult> {
  if (!translator) throw new Error('model_not_loaded: call load first');
  const outputs = await translator(texts);
  const list = Array.isArray(outputs) ? outputs : [outputs];
  return { texts: list.map((o) => (o as { translation_text: string }).translation_text) };
}

interface RpcRequest {
  id: string;
  method: 'load' | 'translate' | 'dispose';
  args?: unknown;
}

self.onmessage = async (event: MessageEvent<RpcRequest>): Promise<void> => {
  const { id, method, args } = event.data;
  try {
    let result: unknown;
    switch (method) {
      case 'load': {
        const { modelId, device } = args as { modelId: string; device: ModelDevice };
        await loadModel(modelId, device, (fraction) => {
          self.postMessage({ type: 'progress', fraction });
        });
        result = undefined;
        break;
      }
      case 'translate': {
        const { texts } = args as { texts: string[] };
        result = await translate(texts);
        break;
      }
      case 'dispose':
        translator = null;
        result = undefined;
        break;
      default:
        throw new Error(`unknown_method: ${String(method)}`);
    }
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
