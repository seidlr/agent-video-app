/// <reference lib="webworker" />
/**
 * Runs closed-set (RF-DETR-nano/YOLOS-tiny) and zero-shot (Grounding-DINO-tiny) object detection
 * in a dedicated Worker, per the plan's Task 8 Key Decisions. Mirrors segment.worker.ts's own RPC
 * shape and caching setup exactly.
 *
 * API confirmed directly against the installed @huggingface/transformers@4.2.0 type declarations
 * AND its actual `dist/transformers.js` implementation (the type declarations alone don't specify
 * the `percentage` option's coordinate scale): `pipeline('object-detection'|
 * 'zero-shot-object-detection', repo, {device, dtype})` returns a callable `(image, [labels],
 * {threshold, percentage}) => Promise<[{label, score, box:{xmin,ymin,xmax,ymax}}]>` --
 * `percentage:true` does NOT mean "0-100": reading `post_process_object_detection`'s source shows
 * boxes are only ever scaled by `target_sizes` when that's non-null, so `percentage:true` (which
 * passes `target_sizes:null`) leaves the model's own raw normalized [0,1] box coordinates
 * untouched -- exactly this app's own normalized-box convention, confirmed rather than assumed.
 */
import { env, pipeline } from '@huggingface/transformers';
import type { ObjectDetectionOutput, ObjectDetectionPipeline, ZeroShotObjectDetectionOutput, ZeroShotObjectDetectionPipeline } from '@huggingface/transformers';
import { getCatalogEntry, type ModelDevice } from './catalog';

env.useBrowserCache = true;
env.cacheKey = 'agent-video-studio-models';
env.useWasmCache = true;

let closedSetDetector: ObjectDetectionPipeline | null = null;
let zeroShotDetector: ZeroShotObjectDetectionPipeline | null = null;

async function loadModel(modelId: string, device: ModelDevice, onProgress: (fraction: number) => void): Promise<void> {
  const entry = getCatalogEntry(modelId);
  if (!entry) throw new Error(`unknown_model: ${modelId}`);

  const progress_callback = (event: { status: string; loaded?: number; total?: number }): void => {
    if (event.status === 'progress' && event.total) onProgress((event.loaded ?? 0) / event.total);
  };

  if (entry.task === 'zero-shot-object-detection') {
    zeroShotDetector = await pipeline('zero-shot-object-detection', entry.repo, { device, dtype: entry.dtype as 'q4f16', progress_callback });
  } else {
    closedSetDetector = await pipeline('object-detection', entry.repo, { device, dtype: entry.dtype as 'q4f16', progress_callback });
  }
  onProgress(1);
}

export interface DetectionResult {
  label: string;
  score: number;
  box: { x: number; y: number; w: number; h: number };
}

function toNormalizedBox(box: { xmin: number; ymin: number; xmax: number; ymax: number }): { x: number; y: number; w: number; h: number } {
  return { x: box.xmin, y: box.ymin, w: box.xmax - box.xmin, h: box.ymax - box.ymin };
}

/** Grounding-DINO's own text-conditioned convention (per the plan's Key Decisions): every
 * candidate label joined into ONE phrase-per-sentence string ("a red car. a person."), not one
 * call per label the way OWL-ViT-style zero-shot models expect. */
function joinGroundingDinoLabels(labels: string[]): string {
  const phrases = labels.map((l) => l.trim().replace(/\.+$/, '')).filter((l) => l.length > 0);
  return `${phrases.join('. ')}.`;
}

async function detect(bitmap: ImageBitmap, labels: string[] | undefined, threshold: number): Promise<DetectionResult[]> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  ctx.drawImage(bitmap, 0, 0);

  if (labels && labels.length > 0) {
    if (!zeroShotDetector) throw new Error('model_not_loaded: call load first');
    const output = (await zeroShotDetector(canvas, [joinGroundingDinoLabels(labels)], {
      threshold,
      percentage: true,
    })) as ZeroShotObjectDetectionOutput;
    // transformers.js's grounded-object-detection decoding includes the tokenizer's own trailing
    // [SEP] token in `label` (confirmed empirically, not documented) -- strip it so the agent sees
    // the matched phrase text, not a raw tokenizer artifact.
    return output.map((d) => ({ label: d.label.replace(/\s*\[SEP\]\s*$/, '').trim(), score: d.score, box: toNormalizedBox(d.box) }));
  }

  if (!closedSetDetector) throw new Error('model_not_loaded: call load first');
  const output = (await closedSetDetector(canvas, { threshold, percentage: true })) as ObjectDetectionOutput;
  return output.map((d) => ({ label: d.label, score: d.score, box: toNormalizedBox(d.box) }));
}

interface RpcRequest {
  id: string;
  method: 'load' | 'detect' | 'dispose';
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
      case 'detect': {
        const { bitmap, labels, threshold } = args as { bitmap: ImageBitmap; labels?: string[]; threshold?: number };
        result = await detect(bitmap, labels, threshold ?? 0.3);
        break;
      }
      case 'dispose':
        closedSetDetector = null;
        zeroShotDetector = null;
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
