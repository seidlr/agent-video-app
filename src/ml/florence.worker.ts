/// <reference lib="webworker" />
/**
 * Runs Florence-2 OCR/grounding (Task 12 Key Decisions) in a dedicated Worker. Mirrors
 * segment.worker.ts's own RPC shape; loads @huggingface/transformers from the CDN like every
 * other ML worker (transformersCdn.ts).
 *
 * `Florence2ForConditionalGeneration` + `AutoProcessor` confirmed directly against the installed
 * @huggingface/transformers@4.2.0 source (florence2/processing_florence2.js): task tokens
 * (`<OCR_WITH_REGION>`, `<DENSE_REGION_CAPTION>`, `<CAPTION_TO_PHRASE_GROUNDING>`) confirmed live
 * against onnx-community/Florence-2-base-ft's own preprocessor_config.json
 * (task_prompts_without_inputs/task_prompts_with_input), not assumed from the model card.
 * `post_process_generation(text, task, image_size)` returns pixel coordinates already scaled by
 * `image_size` -- read directly from its own implementation (`(Number(x)+0.5)/size_per_bin *
 * image_size[i%2]`, against the regex's own x,y,x,y,... capture order), so `image_size` is passed
 * here as `[bitmap.width, bitmap.height]` rather than its own docstring's "height x width" phrasing
 * -- a reasoned-from-source choice, could not be independently verified against a real box on a
 * known fixture (see the KNOWN BLOCKER below, which stops model loading before any generation
 * happens at all).
 *
 * KNOWN BLOCKER (external, not fixed by this file, see the plan's own Deviations entry): loading
 * ANY onnx-community Florence-2 repo (both `-base-ft` and plain `-base` tried) fails session
 * creation with a real onnxruntime-web error -- "Subgraph output (logits) is an outer scope value
 * being returned directly" on webgpu, a different LayerNormFusion error on wasm -- confirmed live
 * across both backends and both `q4f16`/`fp16` dtypes, and NOT fixed by
 * `session_options:{graphOptimizationLevel:'disabled'}` (the failure is a graph *validation* error
 * at parse time, before optimization passes ever run). This is a genuine incompatibility between
 * `@huggingface/transformers@4.2.0`'s pinned onnxruntime-web dev build
 * (`1.26.0-dev.20260416-b7804b056c`) and Florence-2's merged-decoder ONNX export, not something
 * fixable from the calling code -- `read_text`/`dense_captions`/`ground_phrase` are implemented and
 * registered correctly but cannot actually load a model until this is resolved upstream (a
 * transformers.js update pinning a fixed onnxruntime-web, or a re-exported model that avoids the
 * offending graph pattern).
 */
import type { Florence2ForConditionalGeneration as Florence2ModelType, PreTrainedModel, Processor, Tensor } from '@huggingface/transformers';
import { getCatalogEntry } from './catalog';
import { downloadProgressCallback, loadTransformers } from './transformersCdn';

/** `post_process_generation`'s own return type isn't part of the package's public type-level
 * export surface (same situation as segment.worker.ts's `MaskProcessor`) -- narrows the one method
 * actually used, plus the model-generation helper `_call`, both real Florence2Processor methods. */
interface Florence2Processor extends Processor {
  post_process_generation(
    text: string,
    task: string,
    imageSize: [number, number],
  ): Record<string, { labels: string[]; quad_boxes?: number[][]; bboxes?: number[][] } | string>;
}

let model: PreTrainedModel | null = null;
let processor: Florence2Processor | null = null;

async function loadModel(modelId: string, onProgress: (fraction: number) => void): Promise<void> {
  const entry = getCatalogEntry(modelId);
  if (!entry) throw new Error(`unknown_model: ${modelId}`);
  const { AutoProcessor, Florence2ForConditionalGeneration } = await loadTransformers();

  const progress_callback = downloadProgressCallback(onProgress);

  model = await (Florence2ForConditionalGeneration as typeof Florence2ModelType).from_pretrained(entry.repo, {
    dtype: entry.dtype as Parameters<typeof Florence2ModelType.from_pretrained>[1] extends { dtype?: infer D } ? D : never,
    device: entry.device,
    progress_callback,
  });
  processor = (await AutoProcessor.from_pretrained(entry.repo)) as Florence2Processor;
  onProgress(1);
}

export interface FlorenceBox {
  /** The matched label/phrase (OCR'd text, a dense-caption description, or a grounded phrase). */
  label: string;
  /** Normalized [0,1] box -- OCR's own quad output is reduced to its bounding rectangle. */
  box: { x: number; y: number; w: number; h: number };
}

function quadToBox(quad: number[], width: number, height: number): { x: number; y: number; w: number; h: number } {
  const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!];
  const ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!];
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  return { x: x0 / width, y: y0 / height, w: (x1 - x0) / width, h: (y1 - y0) / height };
}

function bboxToBox(bbox: number[], width: number, height: number): { x: number; y: number; w: number; h: number } {
  const [x0, y0, x1, y1] = bbox as [number, number, number, number];
  return { x: x0 / width, y: y0 / height, w: (x1 - x0) / width, h: (y1 - y0) / height };
}

async function runTask(bitmap: ImageBitmap, task: string, textInput?: string): Promise<{ text: string; boxes: FlorenceBox[] }> {
  if (!model || !processor) throw new Error('model_not_loaded: call load first');
  const { RawImage } = await loadTransformers();

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  ctx.drawImage(bitmap, 0, 0);
  const rawImage = RawImage.fromCanvas(canvas);

  const prompt = textInput ? `${task}${textInput}` : task;
  const inputs = await processor(rawImage, prompt);
  const generatedIds = (await model.generate({
    ...inputs,
    max_new_tokens: 256,
  } as never)) as Tensor;
  const [decoded] = processor.batch_decode(generatedIds, { skip_special_tokens: false }) as string[];

  // See this file's own module doc comment: [width, height] here is reasoned from
  // post_process_generation's own implementation, not yet independently verified live.
  const result = processor.post_process_generation(decoded ?? '', task, [bitmap.width, bitmap.height]);
  const parsed = result[task];
  if (!parsed || typeof parsed === 'string') return { text: typeof parsed === 'string' ? parsed : '', boxes: [] };

  const boxes: FlorenceBox[] = parsed.quad_boxes
    ? parsed.quad_boxes.map((quad, i) => ({ label: parsed.labels[i] ?? '', box: quadToBox(quad, bitmap.width, bitmap.height) }))
    : (parsed.bboxes ?? []).map((bbox, i) => ({ label: parsed.labels[i] ?? '', box: bboxToBox(bbox, bitmap.width, bitmap.height) }));

  return { text: '', boxes };
}

interface RpcRequest {
  id: string;
  method: 'load' | 'read_text' | 'dense_captions' | 'ground_phrase' | 'dispose';
  args?: unknown;
}

self.onmessage = async (event: MessageEvent<RpcRequest>): Promise<void> => {
  const { id, method, args } = event.data;
  try {
    let result: unknown;
    switch (method) {
      case 'load': {
        const { modelId } = args as { modelId: string };
        await loadModel(modelId, (fraction) => {
          self.postMessage({ type: 'progress', fraction });
        });
        result = undefined;
        break;
      }
      case 'read_text': {
        const { bitmap } = args as { bitmap: ImageBitmap };
        result = await runTask(bitmap, '<OCR_WITH_REGION>');
        break;
      }
      case 'dense_captions': {
        const { bitmap } = args as { bitmap: ImageBitmap };
        result = await runTask(bitmap, '<DENSE_REGION_CAPTION>');
        break;
      }
      case 'ground_phrase': {
        const { bitmap, phrase } = args as { bitmap: ImageBitmap; phrase: string };
        result = await runTask(bitmap, '<CAPTION_TO_PHRASE_GROUNDING>', phrase);
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
