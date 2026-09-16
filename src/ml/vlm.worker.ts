/// <reference lib="webworker" />
/**
 * Runs the three VLM tiers (Task 12 Key Decisions) -- vlm-fast (SmolVLM-256M), vlm-default
 * (LFM2.5-VL-450M), vlm-quality (Qwen3.5-0.8B) -- in a dedicated Worker. Mirrors segment.worker.ts's
 * own RPC shape and caching setup; loads @huggingface/transformers from the CDN (transformersCdn.ts)
 * for the same reason every other ML worker does.
 *
 * `AutoModelForImageTextToText` + `AutoProcessor` confirmed directly against the installed
 * @huggingface/transformers@4.2.0 type declarations. Chat-message shape (`buildDescribeFrameMessages`
 * etc., vlmPrompts.ts) matches the package's own documented VLM usage: `processor.apply_chat_template`
 * turns one `{type:'image'}` placeholder per frame plus a trailing `{type:'text'}` turn into the
 * prompt string, then `processor(text, images)` (or `(images, text)` -- see `generate()`'s own
 * comment; the argument order is not consistent across VLM architectures) tokenizes it together
 * with the actual RawImage[] pixels.
 */
import type { AutoModelForImageTextToText as AutoModelForImageTextToTextType, PreTrainedModel, Processor, RawImage as RawImageType } from '@huggingface/transformers';
import type { ChatMessage } from './vlmPrompts';
import { getCatalogEntry, type ModelDevice } from './catalog';
import { loadTransformers } from './transformersCdn';

let model: PreTrainedModel | null = null;
let processor: Processor | null = null;

const MAX_NEW_TOKENS_SINGLE = 256;
const MAX_NEW_TOKENS_RANGE = 512;

async function loadModel(modelId: string, device: ModelDevice, onProgress: (fraction: number) => void): Promise<void> {
  const entry = getCatalogEntry(modelId);
  if (!entry) throw new Error(`unknown_model: ${modelId}`);
  const { AutoModelForImageTextToText, AutoProcessor } = await loadTransformers();

  const progress_callback = (event: { status: string; loaded?: number; total?: number }): void => {
    if (event.status === 'progress' && event.total) onProgress((event.loaded ?? 0) / event.total);
  };

  // vlm-fast is the only tier with a wasm fallback (Key Decisions: "wasm fallback only for
  // vlm-fast") -- the other two tiers are large enough that a wasm run would be impractically slow.
  model = await (AutoModelForImageTextToText as typeof AutoModelForImageTextToTextType).from_pretrained(entry.repo, {
    dtype: entry.dtype as Parameters<typeof AutoModelForImageTextToTextType.from_pretrained>[1] extends { dtype?: infer D } ? D : never,
    device,
    progress_callback,
  });
  processor = await AutoProcessor.from_pretrained(entry.repo);
  onProgress(1);
}

async function bitmapToRawImage(bitmap: ImageBitmap, RawImage: typeof RawImageType): Promise<InstanceType<typeof RawImageType>> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  ctx.drawImage(bitmap, 0, 0);
  return RawImage.fromCanvas(canvas);
}

interface GenerateResult {
  text: string;
}

/** Some chat templates (confirmed live: onnx-community/LFM2.5-VL-450M-ONNX's own) wrap the
 * assistant turn in Jinja's `{% generation %}`/`{% endgeneration %}` tags -- a real, standard tag
 * some HF templates use to mark spans for training-time loss masking, with no effect on rendered
 * output. `@huggingface/jinja` (the minimal template engine transformers.js bundles) doesn't
 * implement this tag at all and throws `Unknown statement type: generation` the moment it's
 * present, regardless of whether any conversation in this app's own inference-only usage would
 * ever exercise it. Stripping just the tag markers (keeping their body) is a safe, semantics-
 * preserving fix for the inference case this app actually needs -- confirmed by testing that the
 * stripped template still renders the loaded model's own real chat text correctly. */
function stripUnsupportedGenerationTag(template: string): string {
  return template.replace(/\{%-?\s*generation\s*-?%\}/g, '').replace(/\{%-?\s*endgeneration\s*-?%\}/g, '');
}

async function generate(messages: ChatMessage[], images: InstanceType<typeof RawImageType>[], maxNewTokens: number, onToken: (chunk: string) => void): Promise<GenerateResult> {
  if (!model || !processor) throw new Error('model_not_loaded: call load first');
  const tokenizer = processor.tokenizer;
  if (!tokenizer) throw new Error('tokenizer_unavailable: the loaded processor has no tokenizer');
  const { TextStreamer } = await loadTransformers();

  const chat_template = stripUnsupportedGenerationTag(tokenizer.get_chat_template());
  const text = processor.apply_chat_template(messages as never, { chat_template, add_generation_prompt: true }) as string;
  const imagesArg = images.length > 0 ? images : undefined;
  // No single (text, images) argument order works across every VLM processor -- confirmed live,
  // reading each family's own processing_*.js: idefics3/smolvlm, gemma3, qwen2_vl, phi3_v all use
  // `_call(text, images, ...)`, while lfm2_vl (and Florence2, handled separately in
  // florence.worker.ts) use `_call(images, text, ...)`. Rather than hardcode a per-model-family
  // map here (this worker only knows the catalog id, not which convention its architecture uses,
  // and a future added tier could use either), try the more common (text, images) order first and
  // fall back to (images, text) on the exact "not iterable" failure that order produces when it's
  // the wrong one for this model.
  let inputs: Awaited<ReturnType<Processor['_call']>>;
  try {
    inputs = await processor(text, imagesArg);
  } catch (error) {
    if (!(error instanceof TypeError) || !error.message.includes('iterable')) throw error;
    inputs = await processor(imagesArg, text);
  }

  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: onToken,
  });

  const outputs = await model.generate({
    ...inputs,
    max_new_tokens: maxNewTokens,
    streamer,
  } as never);

  const inputLength = (inputs as { input_ids: { dims: number[] } }).input_ids.dims.at(-1) ?? 0;
  const generatedIds = (outputs as { slice(...args: unknown[]): unknown }).slice(null, [inputLength, null]);
  const decoded = processor.batch_decode(generatedIds as never, { skip_special_tokens: true }) as string[];
  return { text: (decoded[0] ?? '').trim() };
}

interface RpcRequest {
  id: string;
  method: 'load' | 'generate' | 'dispose';
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
      case 'generate': {
        const { messages, bitmaps, range } = args as { messages: ChatMessage[]; bitmaps: ImageBitmap[]; range?: boolean };
        const { RawImage } = await loadTransformers();
        const images = await Promise.all(bitmaps.map((b) => bitmapToRawImage(b, RawImage)));
        result = await generate(messages, images, range ? MAX_NEW_TOKENS_RANGE : MAX_NEW_TOKENS_SINGLE, (chunk) => {
          self.postMessage({ type: 'stream', id, chunk });
        });
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
