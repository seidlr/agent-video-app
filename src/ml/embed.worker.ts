/// <reference lib="webworker" />
/**
 * Runs MobileCLIP-S0 text/image embedding (`search_frames`) and DINOv3 patch-mean image embedding
 * (`find_similar_frames {method:'dino'}`, and Task 8's `dino` `TrackerStrategy` registration) in a
 * dedicated Worker, per the plan's Task 8 Key Decisions. Mirrors segment.worker.ts's own RPC shape
 * and caching setup exactly.
 *
 * MobileCLIP's `config.json` declares `model_type:"clip"` -- confirmed directly against the live
 * Hugging Face file, not assumed from the model's name -- so it loads through transformers.js's
 * ordinary `CLIPTextModelWithProjection`/`CLIPVisionModelWithProjection` classes (its own
 * documented usage example), not a MobileCLIP-specific class (none exists in this package).
 * DINOv3 has a real `pipeline('image-feature-extraction', ...)` task, whose own type declaration
 * literally uses `onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX` as its documented example.
 */
import { AutoProcessor, AutoTokenizer, CLIPTextModelWithProjection, CLIPVisionModelWithProjection, RawImage, env, pipeline } from '@huggingface/transformers';
import type { ImageFeatureExtractionPipeline, PreTrainedModel, PreTrainedTokenizer, Processor, Tensor } from '@huggingface/transformers';
import { getCatalogEntry, type ModelDevice } from './catalog';

env.useBrowserCache = true;
env.cacheKey = 'agent-video-studio-models';
env.useWasmCache = true;

let clipTokenizer: PreTrainedTokenizer | null = null;
let clipProcessor: Processor | null = null;
let clipTextModel: PreTrainedModel | null = null;
let clipVisionModel: PreTrainedModel | null = null;
let dinoExtractor: ImageFeatureExtractionPipeline | null = null;

async function loadModel(modelId: string, device: ModelDevice, onProgress: (fraction: number) => void): Promise<void> {
  const entry = getCatalogEntry(modelId);
  if (!entry) throw new Error(`unknown_model: ${modelId}`);

  const progress_callback = (event: { status: string; loaded?: number; total?: number }): void => {
    if (event.status === 'progress' && event.total) onProgress((event.loaded ?? 0) / event.total);
  };

  if (modelId === 'mobileclip-s0') {
    clipTokenizer = await AutoTokenizer.from_pretrained(entry.repo);
    clipProcessor = await AutoProcessor.from_pretrained(entry.repo);
    [clipTextModel, clipVisionModel] = await Promise.all([
      CLIPTextModelWithProjection.from_pretrained(entry.repo, { dtype: entry.dtype as 'int8', device, progress_callback }),
      CLIPVisionModelWithProjection.from_pretrained(entry.repo, { dtype: entry.dtype as 'int8', device, progress_callback }),
    ]);
  } else {
    dinoExtractor = await pipeline('image-feature-extraction', entry.repo, { device, dtype: entry.dtype as 'q4', progress_callback });
  }
  onProgress(1);
}

/** L2-normalizes in place so downstream cosine similarity is a plain dot product (both sides
 * already unit-length) -- CLIP/DINO embeddings aren't normalized by the raw model output. */
function normalize(vector: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vector.length; i++) norm += (vector[i] ?? 0) ** 2;
  norm = Math.sqrt(norm) || 1;
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = (vector[i] ?? 0) / norm;
  return out;
}

async function embedText(query: string): Promise<Float32Array> {
  if (!clipTokenizer || !clipTextModel) throw new Error('model_not_loaded: call load first');
  // MobileCLIP's text encoder (like classic CLIP) has a FIXED 77-token context length baked into
  // its ONNX graph (tokenizer_config.json's own model_max_length:77, confirmed empirically too --
  // the default padding:true only pads to the batch's own longest sequence, which for a single
  // short query produced a real OrtRun broadcast error trying to combine a 6-token input with the
  // graph's fixed 77-token position embeddings).
  const inputs = clipTokenizer([query], { padding: 'max_length', max_length: 77, truncation: true });
  const { text_embeds } = (await clipTextModel(inputs)) as { text_embeds: Tensor };
  return normalize(Float32Array.from(text_embeds.data as ArrayLike<number>));
}

async function embedImage(bitmap: ImageBitmap): Promise<Float32Array> {
  if (!clipProcessor || !clipVisionModel) throw new Error('model_not_loaded: call load first');
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  ctx.drawImage(bitmap, 0, 0);
  const rawImage = RawImage.fromCanvas(canvas);
  const inputs = await clipProcessor(rawImage);
  const { image_embeds } = (await clipVisionModel(inputs)) as { image_embeds: Tensor };
  return normalize(Float32Array.from(image_embeds.data as ArrayLike<number>));
}

/** DINOv3's raw output is per-PATCH hidden states (dims `[1, numTokens, hiddenSize]`, token 0
 * being the CLS token per its own documented example) -- the plan's own "patch-mean embedding"
 * averages every non-CLS patch token into one vector representing the whole frame. */
async function embedDino(bitmap: ImageBitmap): Promise<Float32Array> {
  if (!dinoExtractor) throw new Error('model_not_loaded: call load first');
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  ctx.drawImage(bitmap, 0, 0);
  const rawImage = RawImage.fromCanvas(canvas);

  const features = (await dinoExtractor(rawImage as never)) as Tensor;
  const [, numTokens, hiddenSize] = features.dims as [number, number, number];
  const data = features.data as ArrayLike<number>;

  const mean = new Float32Array(hiddenSize);
  const patchCount = numTokens - 1; // exclude the CLS token at index 0
  for (let token = 1; token < numTokens; token++) {
    const offset = token * hiddenSize;
    for (let d = 0; d < hiddenSize; d++) mean[d] = (mean[d] ?? 0) + (data[offset + d] ?? 0) / patchCount;
  }
  return normalize(mean);
}

interface RpcRequest {
  id: string;
  method: 'load' | 'embed_text' | 'embed_image' | 'embed_dino' | 'dispose';
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
      case 'embed_text': {
        const { query } = args as { query: string };
        result = await embedText(query);
        break;
      }
      case 'embed_image': {
        const { bitmap } = args as { bitmap: ImageBitmap };
        result = await embedImage(bitmap);
        break;
      }
      case 'embed_dino': {
        const { bitmap } = args as { bitmap: ImageBitmap };
        result = await embedDino(bitmap);
        break;
      }
      case 'dispose':
        clipTokenizer = null;
        clipProcessor = null;
        clipTextModel = null;
        clipVisionModel = null;
        dinoExtractor = null;
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
