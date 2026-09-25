/// <reference lib="webworker" />
/**
 * Runs background-removal matting (Task 13 Key Decisions: MODNet for portraits, BiRefNet_lite for
 * anything else) in a dedicated Worker. Mirrors segment.worker.ts's own RPC shape; loads
 * @huggingface/transformers from the CDN like every other ML worker (transformersCdn.ts).
 *
 * `pipeline('background-removal', repo)` is a real transformers.js pipeline (confirmed directly
 * against its own source, pipelines/background-removal.js): it returns a `RawImage` with the
 * subject's own alpha channel already composited in (`cloned.putAlpha(mask)`), not a separate mask
 * -- so this worker's own job is just to run that pipeline and hand back the raw RGBA pixels;
 * temporal EMA smoothing across frames and the actual replace-background compositing
 * (media/composite.ts's `applyMatte`) both happen in agent/tools/effects.ts, which has the
 * cross-frame/cross-call context this stateless per-call worker doesn't.
 */
import type { ImageSegmentationPipeline } from '@huggingface/transformers';
import { getCatalogEntry, type ModelDevice } from './catalog';
import { downloadProgressCallback, loadTransformers } from './transformersCdn';

let segmenter: ImageSegmentationPipeline | null = null;

async function loadModel(modelId: string, device: ModelDevice, onProgress: (fraction: number) => void): Promise<void> {
  const entry = getCatalogEntry(modelId);
  if (!entry) throw new Error(`unknown_model: ${modelId}`);
  const { pipeline } = await loadTransformers();

  const progress_callback = downloadProgressCallback(onProgress);

  segmenter = (await pipeline('background-removal', entry.repo, {
    device,
    dtype: entry.dtype as Parameters<typeof pipeline>[2] extends { dtype?: infer D } ? D : never,
    progress_callback,
  })) as unknown as ImageSegmentationPipeline;
  onProgress(1);
}

interface MatteResult {
  rgba: Uint8ClampedArray;
  alpha: Float32Array;
  width: number;
  height: number;
}

async function removeBackground(bitmap: ImageBitmap): Promise<MatteResult> {
  if (!segmenter) throw new Error('model_not_loaded: call load first');
  const { RawImage } = await loadTransformers();

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  ctx.drawImage(bitmap, 0, 0);
  const rawImage = RawImage.fromCanvas(canvas);

  const output = (await segmenter(rawImage as never)) as unknown as { data: Uint8ClampedArray; width: number; height: number; channels: number };
  const pixelCount = output.width * output.height;
  const alpha = new Float32Array(pixelCount);
  for (let p = 0; p < pixelCount; p++) alpha[p] = (output.data[p * output.channels + 3] ?? 255) / 255;

  return { rgba: output.data, alpha, width: output.width, height: output.height };
}

interface RpcRequest {
  id: string;
  method: 'load' | 'remove_background' | 'dispose';
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
      case 'remove_background': {
        const { bitmap } = args as { bitmap: ImageBitmap };
        result = await removeBackground(bitmap);
        break;
      }
      case 'dispose':
        segmenter = null;
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
