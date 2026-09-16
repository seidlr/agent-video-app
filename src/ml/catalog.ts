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
   * `is_pipeline_cached` key off when `usesPipeline` isn't `false`. For a model loaded via a raw
   * `AutoModelForX`/`AutoProcessor` pair instead of `pipeline()` (pyannote has no corresponding
   * pipeline task), this is a cosmetic label only -- `ml/client.ts` routes size/cache checks
   * through the generic, task-agnostic `ModelRegistry.get_files`/`is_cached` instead. */
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
  /** `false` for a model loaded via raw `AutoModelForX.from_pretrained` + `AutoProcessor` rather
   * than `pipeline(task, ...)` -- see `task`'s own doc comment. Defaults to `true`. */
  usesPipeline?: boolean;
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
  {
    id: 'pyannote-segmentation',
    // No corresponding pipeline() task -- loaded via AutoModelForAudioFrameClassification +
    // AutoProcessor directly (see modeling_pyannote.d.ts's own documented usage). This string is
    // therefore cosmetic only (list_models/Models panel display); see `usesPipeline` below.
    task: 'audio-frame-classification',
    repo: 'onnx-community/pyannote-segmentation-3.0',
    dtype: 'q8',
    family: 'audio',
    device: 'wasm', // a ~1.5MB CPU-friendly quantization; no meaningful WebGPU benefit at this size
    license: 'MIT',
    url: 'https://huggingface.co/onnx-community/pyannote-segmentation-3.0',
    // Verified against the live HF tree API: onnx/model_quantized.onnx (1,542,308 B), matching
    // the plan's own "quantized 1.5 MB" figure.
    approxMB: 2,
    usesPipeline: false,
  },
  {
    id: 'ast-audio-events',
    task: 'audio-classification',
    repo: 'onnx-community/ast-finetuned-audioset-10-10-0.4593-ONNX',
    dtype: 'q4f16',
    family: 'audio',
    device: 'webgpu',
    license: 'BSD-3-Clause', // upstream MIT/ast-finetuned-audioset-10-10-0.4593 is BSD-3-Clause
    url: 'https://huggingface.co/onnx-community/ast-finetuned-audioset-10-10-0.4593-ONNX',
    // Verified against the live HF tree API: onnx/model_q4f16.onnx (51,388,564 B), matching the
    // plan's own "51 MB" figure.
    approxMB: 51,
  },
  {
    id: 'mobileclip-s0',
    // Loads two independent model classes (CLIPTextModelWithProjection + CLIPVisionModelWith
    // Projection) rather than one pipeline() call -- see ml/embed.worker.ts's own docstring. Not
    // a real transformers.js pipeline task; cosmetic display label only (usesPipeline:false).
    task: 'feature-extraction',
    repo: 'Xenova/mobileclip_s0',
    dtype: 'int8',
    family: 'embed',
    device: 'wasm', // int8 is a CPU-oriented quantization; no WebGPU kernel benefit at this size
    // Apple's own weights license (verified via github.com/apple/ml-mobileclip's LICENSE_MODELS,
    // identical text mirrored on huggingface.co/apple/MobileCLIP-S0/blob/main/LICENSE): the
    // "Apple Machine Learning Research Model License Agreement", which grants use "exclusively
    // for Research Purposes" and explicitly excludes commercial exploitation or use in any
    // commercial product/service. This app's own `search_frames` gate surfaces this exact string
    // in list_models/the Models panel before any download, but shipping this feature in a
    // publicly deployed tool is a product/legal call outside this implementation's scope -- see
    // the plan's own Task 8 Deviations entry.
    license: 'Apple ML Research Model License (research use only, no commercial use)',
    url: 'https://huggingface.co/Xenova/mobileclip_s0',
    // Verified against the live HF tree API: onnx/text_model_int8.onnx (42,799,230 B) +
    // onnx/vision_model_int8.onnx (11,846,808 B), matching the plan's own "42.8 MB"/"11.8 MB"
    // figures exactly.
    approxMB: 55,
    usesPipeline: false,
  },
  {
    id: 'dinov3-vits16',
    task: 'image-feature-extraction',
    repo: 'onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX',
    dtype: 'q4',
    family: 'embed',
    device: 'webgpu',
    // Meta's own "DINOv3 License" (ai.meta.com/resources/models-and-libraries/dinov3-license) --
    // a custom but genuinely commercial-use-permitting license (unlike MobileCLIP's above),
    // conditioned on displaying "Built with DINOv3" somewhere in the product; noted here and in
    // the plan's Task 8 Deviations as an attribution item for a later docs/credits task, not
    // implemented as UI yet.
    license: 'DINOv3 License (commercial use OK; requires "Built with DINOv3" attribution)',
    url: 'https://huggingface.co/onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX',
    // Verified against the live HF tree API: onnx/model_q4.onnx (152,401 B) +
    // onnx/model_q4.onnx_data (14,684,160 B), matching the plan's own "q4 15 MB" figure.
    approxMB: 15,
  },
  // Task 12: the tools' own `model?: fast|default|quality` argument maps 1:1 to these three
  // catalog ids by the `vlm-` prefix (`resolveVlmId()` in vlm.worker.ts) -- no other mapping
  // exists. All three verified live against the real HF tree API for their q4f16 file set (the
  // exact files transformers.js downloads for this dtype): each approxMB below is computed from
  // those real byte counts (MB = bytes/1e6, matching client.ts's own convention), not the repo's
  // total size across every quantization variant.
  {
    id: 'vlm-fast',
    // `image-text-to-text` is a real AutoModelForX class mapping but NOT a recognized
    // ModelRegistry pipeline task (confirmed live: is_pipeline_cached rejected it with "Unsupported
    // pipeline task") -- loaded via AutoModelForImageTextToText + AutoProcessor directly, same as
    // Florence-2 below, hence usesPipeline:false.
    task: 'image-text-to-text',
    repo: 'HuggingFaceTB/SmolVLM-256M-Instruct',
    dtype: 'q4f16',
    family: 'vlm',
    device: 'webgpu',
    license: 'Apache-2.0',
    url: 'https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct',
    // decoder_model_merged_q4f16 (77,034,560) + embed_tokens_q4f16 (56,770,965) +
    // vision_encoder_q4f16 (55,037,584) = 188,843,109 B.
    approxMB: 189,
    usesPipeline: false,
  },
  {
    id: 'vlm-default',
    task: 'image-text-to-text',
    repo: 'onnx-community/LFM2.5-VL-450M-ONNX',
    dtype: 'q4f16',
    family: 'vlm',
    device: 'webgpu',
    license: 'LFM Open License',
    url: 'https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX',
    // decoder_model_merged_q4f16 (187,056 + .onnx_data 221,411,328) + embed_tokens_q4f16 (1,060 +
    // 38,797,312) + vision_encoder_q4f16 (186,719 + 55,330,304) = 315,913,779 B.
    approxMB: 316,
    usesPipeline: false,
  },
  {
    id: 'vlm-quality',
    task: 'image-text-to-text',
    repo: 'onnx-community/Qwen3.5-0.8B-ONNX',
    dtype: 'q4f16',
    family: 'vlm',
    device: 'webgpu',
    license: 'Apache-2.0',
    url: 'https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX',
    // decoder_model_merged_q4f16 (1,036,898 + .onnx_data 436,662,272) + embed_tokens_q4f16
    // (1,064 + 147,005,440) + vision_encoder_q4f16 (212,694 + 61,919,744) = 646,838,112 B.
    approxMB: 647,
    usesPipeline: false,
  },
  {
    id: 'florence2-base',
    // <OCR_WITH_REGION>/<DENSE_REGION_CAPTION>/<CAPTION_TO_PHRASE_GROUNDING> confirmed live against
    // this exact repo's preprocessor_config.json (task_prompts_without_inputs/task_prompts_with_
    // input) -- not assumed from the model card. No pipeline() task; loaded via
    // Florence2ForConditionalGeneration + AutoProcessor directly (see florence.worker.ts).
    task: 'image-text-to-text',
    repo: 'onnx-community/Florence-2-base-ft',
    dtype: 'q4f16',
    family: 'ocr',
    device: 'webgpu',
    license: 'MIT',
    url: 'https://huggingface.co/onnx-community/Florence-2-base-ft',
    // vision_encoder_q4f16 (62,416,644) + encoder_model_q4f16 (25,705,965) +
    // decoder_model_merged_q4f16 (56,543,716) + embed_tokens_q4f16 (78,780,309) = 223,446,634 B.
    approxMB: 224,
    usesPipeline: false,
  },
  {
    id: 'depth-anything-v2-small',
    task: 'depth-estimation',
    // SHORTCUT: this exact repo (no "-ONNX" suffix) is the one the plan names and its own
    // README's `new_version:` field points to `onnx-community/depth-anything-v2-small-ONNX` as a
    // newer, differently-laid-out mirror -- still resolves fine today (confirmed live), so kept
    // as approved rather than substituted; upgrade trigger: this repo actually going 404/stale.
    repo: 'onnx-community/depth-anything-v2-small',
    dtype: 'q4f16',
    family: 'depth',
    device: 'webgpu',
    license: 'Apache-2.0',
    url: 'https://huggingface.co/onnx-community/depth-anything-v2-small',
    // Verified against the live HF tree API: onnx/model_q4f16.onnx (19,126,267 B), matching the
    // plan's own "19 MB" figure.
    approxMB: 19,
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

export type VlmTier = 'fast' | 'default' | 'quality';

/** Task 12: the one place a VLM tool's own `model?: fast|default|quality` argument maps to a
 * catalog id -- always `vlm-<tier>`, no other mapping exists anywhere else. */
export function resolveVlmId(tier: VlmTier | undefined): string {
  return `vlm-${tier ?? 'default'}`;
}
