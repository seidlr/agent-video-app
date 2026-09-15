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
