/// <reference lib="webworker" />
/**
 * Runs Depth Anything v2 (small) monocular depth estimation in a dedicated Worker, per the plan's
 * Task 8 Key Decisions. Mirrors segment.worker.ts's own RPC shape and caching setup exactly.
 *
 * `predicted_depth`'s own value convention (confirmed against the official Depth-Anything-V2 repo
 * and the corresponding HF `transformers` post-processing code, not assumed): it's an *inverse*
 * depth/disparity map -- LARGER raw values mean CLOSER to the camera, smaller values mean farther
 * away. `estimate_depth {format:'stats'}`'s `near`/`far`/`shotType` all key off that direction.
 */
import type { DepthEstimationPipeline, Tensor } from '@huggingface/transformers';
import { computeDepthStats, type DepthStats } from '../media/depthStats';
import { getCatalogEntry, type ModelDevice } from './catalog';
import { downloadProgressCallback, loadTransformers } from './transformersCdn';

let depthEstimator: DepthEstimationPipeline | null = null;

async function loadModel(modelId: string, device: ModelDevice, onProgress: (fraction: number) => void): Promise<void> {
  const entry = getCatalogEntry(modelId);
  if (!entry) throw new Error(`unknown_model: ${modelId}`);
  const { pipeline } = await loadTransformers();

  const progress_callback = downloadProgressCallback(onProgress);

  depthEstimator = await pipeline('depth-estimation', entry.repo, { device, dtype: entry.dtype as 'q4f16', progress_callback });
  onProgress(1);
}

/** Blue (far) -> red (near) via an HSL hue sweep -- a simple, dependency-free stand-in for a full
 * "turbo"/"jet"-style colormap lookup table, chosen because it's visually intuitive (the classic
 * "cool = far, warm = near" convention) without needing a 256-entry table baked into this file. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let [r1, g1, b1] = [0, 0, 0];
  if (hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

async function colorizeDepth(data: ArrayLike<number>, width: number, height: number, far: number, near: number): Promise<Blob> {
  const range = near - far || 1;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const t = ((data[i] ?? far) - far) / range; // 0 = far, 1 = near
    const [r, g, b] = hslToRgb(240 * (1 - t), 1, 0.5); // 240deg (blue) at t=0 -> 0deg (red) at t=1
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

export interface EstimateDepthResult {
  stats: DepthStats;
  imagePng?: Blob;
  width: number;
  height: number;
}

async function estimateDepth(bitmap: ImageBitmap, includeImage: boolean): Promise<EstimateDepthResult> {
  if (!depthEstimator) throw new Error('model_not_loaded: call load first');
  const { RawImage } = await loadTransformers();
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  ctx.drawImage(bitmap, 0, 0);
  const rawImage = RawImage.fromCanvas(canvas);

  const { predicted_depth } = (await depthEstimator(rawImage)) as { predicted_depth: Tensor };
  const [height, width] = predicted_depth.dims as [number, number];
  const data = predicted_depth.data as ArrayLike<number>;

  const stats = computeDepthStats(data);
  const imagePng = includeImage ? await colorizeDepth(data, width, height, stats.far, stats.near) : undefined;
  return { stats, imagePng, width, height };
}

interface RpcRequest {
  id: string;
  method: 'load' | 'estimate_depth' | 'dispose';
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
      case 'estimate_depth': {
        const { bitmap, includeImage } = args as { bitmap: ImageBitmap; includeImage: boolean };
        result = await estimateDepth(bitmap, includeImage);
        break;
      }
      case 'dispose':
        depthEstimator = null;
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
