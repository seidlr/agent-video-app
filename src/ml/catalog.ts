/**
 * The single list of every model this app can load. Used by `list_models`, the Models panel, and
 * (later tasks) the skill's TOOLS.md and the CSP domain list -- nothing outside this catalog may
 * be fetched (Global Constraints' on-demand-only rule). `approxMB` is a display fallback for
 * before a model's exact size is known; `client.ts`'s `ensureModel` always prefers a live,
 * memoized `ModelRegistry.get_file_metadata` size over it once available.
 */
import type { DataType } from '@huggingface/transformers';

export type ModelFamily = 'segment' | 'detect' | 'embed' | 'depth' | 'audio' | 'asr' | 'tts' | 'translate' | 'vlm' | 'ocr' | 'matte' | 'upscale' | 'mediapipe';

export type ModelDevice = 'webgpu' | 'wasm';

export interface ModelCatalogEntry {
  id: string;
  /** transformers.js pipeline task name -- what `ModelRegistry.get_pipeline_files`/
   * `is_pipeline_cached` key off. */
  task: string;
  /** Hugging Face repo id, e.g. "onnx-community/EdgeTAM-ONNX". */
  repo: string;
  /** Passed straight through to transformers.js's `dtype` pretrained option. */
  dtype: DataType | Record<string, DataType>;
  family: ModelFamily;
  device: ModelDevice;
  license: string;
  /** Repo URL, for docs/skill/UI links. */
  url: string;
  /** Fallback size estimate in MB, computed from the actual files this dtype/device combo
   * downloads (verified against the live Hugging Face file listing, not the repo's total size
   * across every quantization variant). */
  approxMB: number;
}

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: 'edgetam',
    task: 'mask-generation',
    repo: 'onnx-community/EdgeTAM-ONNX',
    dtype: { vision_encoder: 'fp16', prompt_encoder_mask_decoder: 'fp32' },
    family: 'segment',
    device: 'webgpu',
    license: 'Apache-2.0',
    url: 'https://huggingface.co/onnx-community/EdgeTAM-ONNX',
    approxMB: 31,
  },
  {
    id: 'slimsam',
    task: 'mask-generation',
    repo: 'Xenova/slimsam-77-uniform',
    dtype: 'q8',
    family: 'segment',
    device: 'wasm',
    license: 'Apache-2.0',
    url: 'https://huggingface.co/Xenova/slimsam-77-uniform',
    approxMB: 14,
  },
  // Whisper's own repo/dtype is identical regardless of execution backend -- unlike the
  // EdgeTAM/SlimSAM split above, there is only one catalog id per tier. `device` here is a
  // nominal default used for `is_pipeline_cached`/size bookkeeping only; `ml/client.ts` resolves
  // the *actual* runtime device from live WebGPU availability (and the `?ml=wasm` override)
  // before loading, same as it does for every other family.
  {
    id: 'whisper-tiny',
    task: 'automatic-speech-recognition',
    repo: 'onnx-community/whisper-tiny',
    dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' },
    family: 'asr',
    device: 'webgpu',
    license: 'Apache-2.0',
    url: 'https://huggingface.co/onnx-community/whisper-tiny',
    // Verified against the live HF tree API: encoder_model_fp16.onnx (16,519,192 B) +
    // decoder_model_merged_q4.onnx (86,713,702 B).
    approxMB: 103,
  },
  {
    id: 'whisper-base',
    task: 'automatic-speech-recognition',
    repo: 'onnx-community/whisper-base',
    dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' },
    family: 'asr',
    device: 'webgpu',
    license: 'Apache-2.0',
    url: 'https://huggingface.co/onnx-community/whisper-base',
    // Verified against the live HF tree API: encoder_model_fp16.onnx (41,332,612 B) +
    // decoder_model_merged_q4.onnx (123,602,419 B).
    approxMB: 165,
  },
  {
    id: 'rfdetr-nano',
    task: 'object-detection',
    repo: 'onnx-community/rfdetr_nano-ONNX',
    dtype: 'q4f16',
    family: 'detect',
    device: 'webgpu',
    license: 'Apache-2.0',
    url: 'https://huggingface.co/onnx-community/rfdetr_nano-ONNX',
    // Verified against the live HF tree API: onnx/model_q4f16.onnx (18,996,625 B).
    approxMB: 19,
  },
  {
    id: 'yolos-tiny',
    task: 'object-detection',
    repo: 'Xenova/yolos-tiny',
    dtype: 'q4f16',
    family: 'detect',
    device: 'wasm',
    license: 'Apache-2.0', // upstream hustvl/yolos-tiny is Apache-2.0
    url: 'https://huggingface.co/Xenova/yolos-tiny',
    // Verified against the live HF tree API: onnx/model_q4f16.onnx (7,032,046 B).
    approxMB: 7,
  },
  {
    id: 'grounding-dino-tiny',
    task: 'zero-shot-object-detection',
    repo: 'onnx-community/grounding-dino-tiny-ONNX',
    dtype: 'q4f16',
    family: 'detect',
    device: 'webgpu',
    license: 'Apache-2.0',
    url: 'https://huggingface.co/onnx-community/grounding-dino-tiny-ONNX',
    // Verified against the live HF tree API: onnx/model_q4f16.onnx (151,069,879 B), matching the
    // plan's own "~151 MB" figure exactly.
    approxMB: 151,
  },
];

export function getCatalogEntry(id: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

/** Picks the segmentation model for the current environment: EdgeTAM on WebGPU when available
 * (the plan's default), SlimSAM on wasm otherwise -- or when `?ml=wasm` forces it (Global
 * Constraints: a query-string escape hatch for testing/low-end devices without WebGPU). */
export function pickSegmentModel(webgpuAvailable: boolean, forceWasm: boolean): ModelCatalogEntry {
  const entry = webgpuAvailable && !forceWasm ? getCatalogEntry('edgetam') : getCatalogEntry('slimsam');
  // Both ids are always present in MODEL_CATALOG above; this satisfies the type checker without
  // a runtime possibility the fallback is ever actually needed.
  return entry ?? (MODEL_CATALOG[0] as ModelCatalogEntry);
}

/** Picks the closed-set detection model for the current environment: RF-DETR-nano on WebGPU (the
 * plan's default), YOLOS-tiny on wasm otherwise -- same shape as `pickSegmentModel`. Not used when
 * `detect_objects` is given `labels`, which always routes to `grounding-dino-tiny` instead (a
 * single catalog id, its own actual runtime device resolved by `ml/client.ts` like Whisper's). */
export function pickDetectModel(webgpuAvailable: boolean, forceWasm: boolean): ModelCatalogEntry {
  const entry = webgpuAvailable && !forceWasm ? getCatalogEntry('rfdetr-nano') : getCatalogEntry('yolos-tiny');
  return entry ?? (MODEL_CATALOG[0] as ModelCatalogEntry);
}
