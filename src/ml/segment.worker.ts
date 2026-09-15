/// <reference lib="webworker" />
/**
 * Runs EdgeTAM (webgpu) or SlimSAM (wasm) point/box segmentation in a dedicated Worker, per the
 * plan's Task 7 Key Decisions. One worker per model family (ml/client.ts spawns this file fresh
 * for each `ensureModel('edgetam' | 'slimsam', ...)`); `postMessage`-based RPC keyed by request id
 * mirrors the job-protocol convention used everywhere else in this app (see agent/jobs.ts),
 * adapted to a Worker boundary instead of an in-page async function.
 *
 * API confirmed directly against the installed @huggingface/transformers@4.2.0 type declarations
 * and the onnx-community/EdgeTAM-ONNX / Xenova/slimsam-77-uniform model cards' own documented
 * usage (both Apache-2.0): `AutoProcessor`/`SamModel`/`EdgeTamModel`, `processor(raw_image,
 * {input_points|input_boxes})` -> `model(inputs)` -> `{iou_scores, pred_masks}` ->
 * `processor.post_process_masks(...)`.
 */
import { AutoProcessor, EdgeTamModel, RawImage, SamModel, env } from '@huggingface/transformers';
import type { PreTrainedModel, Processor, Tensor } from '@huggingface/transformers';
import { getCatalogEntry } from './catalog';

// Per the plan's Key Decisions: cache downloaded model files in the browser's own Cache Storage
// (survives a reload without re-downloading) under a name scoped to this app, and cache compiled
// wasm too.
env.useBrowserCache = true;
env.cacheKey = 'agent-video-studio-models';
env.useWasmCache = true;

/** `SamProcessor`/`Sam2Processor` (whichever `AutoProcessor.from_pretrained` resolves to for
 * these two models) both expose `post_process_masks`, but neither is part of the package's public
 * export surface to import and cast to directly -- this narrows the one method actually used. */
interface MaskProcessor extends Processor {
  post_process_masks(pred_masks: Tensor, original_sizes: [number, number][], reshaped_input_sizes: [number, number][]): Promise<Tensor[]>;
}

let model: PreTrainedModel | null = null;
let processor: MaskProcessor | null = null;

interface SegmentPrompt {
  /** Normalized [0,1] point prompts; converted to the frame's own pixel coordinates before
   * reaching the processor, since that's what it expects. */
  points?: { x: number; y: number; label: 0 | 1 }[];
  /** A normalized [0,1] box prompt {x,y,w,h}, alternative to points. */
  box?: { x: number; y: number; w: number; h: number };
}

interface SegmentResult {
  /** The winning mask (highest iou_scores) as a PNG blob, full frame size, alpha=0 outside the
   * mask -- ready to composite directly as MaskOverlay.tsx's <img>. */
  maskPng: Blob;
  /** Normalized [0,1] tight bounding box of the mask. */
  box: { x: number; y: number; w: number; h: number };
  score: number;
}

async function loadModel(modelId: string, onProgress: (fraction: number) => void): Promise<void> {
  const entry = getCatalogEntry(modelId);
  if (!entry) throw new Error(`unknown_model: ${modelId}`);

  const ModelClass = entry.device === 'webgpu' ? EdgeTamModel : SamModel;
  const progress_callback = (event: { status: string; loaded?: number; total?: number }): void => {
    if (event.status === 'progress' && event.total) onProgress((event.loaded ?? 0) / event.total);
  };

  model = await ModelClass.from_pretrained(entry.repo, {
    dtype: entry.dtype as Parameters<typeof ModelClass.from_pretrained>[1] extends { dtype?: infer D } ? D : never,
    device: entry.device,
    progress_callback,
  });
  processor = (await AutoProcessor.from_pretrained(entry.repo)) as MaskProcessor;
  onProgress(1);
}

/** Argmax over a 1D-ish typed array (iou_scores' data, one score per candidate mask). */
function argmax(values: ArrayLike<number>): number {
  let bestIndex = 0;
  let bestValue = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? -Infinity;
    if (v > bestValue) {
      bestValue = v;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/** Tight bounding box (normalized [0,1]) of the true pixels in a boolean/0-1 mask tensor's raw
 * data, given its pixel dimensions. Returns a zero-area box at the mask's center if it's empty
 * (SAM/EdgeTAM practically never returns a completely empty winning mask, but this keeps the
 * result well-formed rather than throwing if it ever does). */
function maskToNormalizedBox(maskData: ArrayLike<number>, width: number, height: number): { x: number; y: number; w: number; h: number } {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((maskData[y * width + x] ?? 0) > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    return { x: 0.5, y: 0.5, w: 0, h: 0 };
  }
  return { x: minX / width, y: minY / height, w: (maxX - minX + 1) / width, h: (maxY - minY + 1) / height };
}

async function segment(bitmap: ImageBitmap, prompt: SegmentPrompt): Promise<SegmentResult> {
  if (!model || !processor) throw new Error('model_not_loaded: call load first');

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  ctx.drawImage(bitmap, 0, 0);
  const rawImage = RawImage.fromCanvas(canvas);

  const processorArgs: Record<string, number[][][]> = {};
  if (prompt.points && prompt.points.length > 0) {
    processorArgs.input_points = [prompt.points.map((p) => [p.x * bitmap.width, p.y * bitmap.height])];
    processorArgs.input_labels = [prompt.points.map((p) => [p.label])] as unknown as number[][][];
  } else if (prompt.box) {
    const { x, y, w, h } = prompt.box;
    processorArgs.input_boxes = [
      [[x * bitmap.width, y * bitmap.height, (x + w) * bitmap.width, (y + h) * bitmap.height]],
    ];
  } else {
    throw new Error('invalid_prompt: segment needs points or a box');
  }

  const inputs = await processor(rawImage, processorArgs);
  const outputs = await model(inputs);
  const masks = await processor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);

  const scores = Array.from(outputs.iou_scores.data as ArrayLike<number>);
  const bestIndex = argmax(scores);

  // masks[0] is image 0's Tensor of every candidate mask (dims [1, numMasks, H, W], per the SAM
  // model card's own documented output shape). .slice(0, bestIndex) pins the batch dim to 0 and
  // the mask-channel dim to the winning index, leaving [H, W] -- the typed equivalent of the
  // model card's own illustrative `masks[0][0]` bracket-indexing example, generalized from a
  // hardcoded channel to the actual argmax index.
  const maskTensor = (masks[0] as Tensor).slice(0, bestIndex);
  const [height, width] = maskTensor.dims as [number, number];
  const maskData = maskTensor.data as ArrayLike<number>;

  const maskPng = await maskToTintedPng(maskData, width, height);

  return { maskPng, box: maskToNormalizedBox(maskData, width, height), score: scores[bestIndex] ?? 0 };
}

/** Renders the mask as a semi-transparent PNG tinted with the app's reserved agent-overlay color
 * (`--color-annotate`, #4fb3d9 -- duplicated as a literal here for the same reason media/capture.ts's
 * own copy is: an OffscreenCanvas 2D context has no computed-style access to read the CSS custom
 * property from, and it doesn't vary by theme), so MaskOverlay.tsx can composite it directly with
 * a plain <img> and no further color processing -- true pixels get the tint at ~55% alpha,
 * false/background pixels are fully transparent. */
async function maskToTintedPng(maskData: ArrayLike<number>, width: number, height: number): Promise<Blob> {
  const ANNOTATE_RGB = [79, 179, 217] as const;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const on = (maskData[i] ?? 0) > 0;
    rgba[i * 4] = ANNOTATE_RGB[0];
    rgba[i * 4 + 1] = ANNOTATE_RGB[1];
    rgba[i * 4 + 2] = ANNOTATE_RGB[2];
    rgba[i * 4 + 3] = on ? 140 : 0;
  }
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

interface RpcRequest {
  id: string;
  method: 'load' | 'segment' | 'dispose';
  args?: unknown;
}

self.onmessage = async (event: MessageEvent<RpcRequest>): Promise<void> => {
  const { id, method, args } = event.data;
  try {
    let result: unknown;
    switch (method) {
      case 'load':
        await loadModel((args as { modelId: string }).modelId, (fraction) => {
          self.postMessage({ type: 'progress', fraction });
        });
        result = undefined;
        break;
      case 'segment': {
        const { bitmap, prompt } = args as { bitmap: ImageBitmap; prompt: SegmentPrompt };
        result = await segment(bitmap, prompt);
        break;
      }
      case 'dispose':
        model = null;
        processor = null;
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
