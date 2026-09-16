/// <reference lib="webworker" />
/**
 * Runs swin2SR super-resolution (Task 13 Key Decisions) in a dedicated Worker, via a real
 * transformers.js `pipeline('image-to-image', ...)` (confirmed directly against its own source,
 * pipelines/image-to-image.js). Loads @huggingface/transformers from the CDN like every other ML
 * worker (transformersCdn.ts). Runs on whatever single image it's given -- 256px tiling with 16px
 * overlap-blending (the plan's own Key Decision, since swin2SR is trained at a fixed small tile
 * size) is the caller's job (agent/tools/effects.ts), which has the cross-tile context this
 * stateless per-call worker doesn't.
 */
import type { ImageToImagePipeline } from '@huggingface/transformers';
import { getCatalogEntry, type ModelDevice } from './catalog';
import { loadTransformers } from './transformersCdn';

let upscaler: ImageToImagePipeline | null = null;

async function loadModel(modelId: string, device: ModelDevice, onProgress: (fraction: number) => void): Promise<void> {
  const entry = getCatalogEntry(modelId);
  if (!entry) throw new Error(`unknown_model: ${modelId}`);
  const { pipeline } = await loadTransformers();

  const progress_callback = (event: { status: string; loaded?: number; total?: number }): void => {
    if (event.status === 'progress' && event.total) onProgress((event.loaded ?? 0) / event.total);
  };

  upscaler = await pipeline('image-to-image', entry.repo, {
    device,
    dtype: entry.dtype as Parameters<typeof pipeline>[2] extends { dtype?: infer D } ? D : never,
    progress_callback,
  });
  onProgress(1);
}

interface UpscaleResult {
  rgb: Uint8Array;
  width: number;
  height: number;
}

async function upscale(bitmap: ImageBitmap): Promise<UpscaleResult> {
  if (!upscaler) throw new Error('model_not_loaded: call load first');
  const { RawImage } = await loadTransformers();

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  ctx.drawImage(bitmap, 0, 0);
  const rawImage = RawImage.fromCanvas(canvas);

  const output = (await upscaler(rawImage as never)) as unknown as { data: Uint8Array; width: number; height: number };
  return { rgb: output.data, width: output.width, height: output.height };
}

interface RpcRequest {
  id: string;
  method: 'load' | 'upscale' | 'dispose';
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
      case 'upscale': {
        const { bitmap } = args as { bitmap: ImageBitmap };
        result = await upscale(bitmap);
        break;
      }
      case 'dispose':
        upscaler = null;
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
