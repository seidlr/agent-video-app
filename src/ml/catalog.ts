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
  // Task 13: matting (background-removal), TTS, upscale, ASR tiers, translation. Every approxMB
  // below is computed the same way as every entry above -- summed real byte counts from the live
  // HF tree API for the exact files this dtype/task combo downloads (verified live via
  // ModelRegistry.get_pipeline_files/get_files against the locally installed
  // @huggingface/transformers@4.2.0, not guessed from a model card).
  {
    id: 'matte-portrait',
    task: 'background-removal',
    repo: 'Xenova/modnet',
    dtype: 'uint8',
    family: 'matte',
    device: 'wasm', // uint8 is a CPU-oriented quantization, same convention as pyannote/mobileclip above
    license: 'Apache-2.0',
    url: 'https://huggingface.co/Xenova/modnet',
    // Verified: onnx/model_uint8.onnx (6,627,048 B).
    approxMB: 7,
  },
  {
    id: 'matte-general',
    task: 'background-removal',
    repo: 'onnx-community/BiRefNet_lite-ONNX',
    dtype: 'fp16',
    family: 'matte',
    device: 'webgpu',
    license: 'MIT',
    url: 'https://huggingface.co/onnx-community/BiRefNet_lite-ONNX',
    // Verified: onnx/model_fp16.onnx (114,538,221 B).
    approxMB: 115,
  },
  {
    id: 'kokoro-tts',
    // Loaded via the `kokoro-js` package's own `KokoroTTS.from_pretrained`, not transformers.js's
    // `pipeline()` -- no real pipeline task exists for TTS here; cosmetic display label only.
    task: 'text-to-speech',
    repo: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    // kokoro-js's own dtype enum is fp32|fp16|q8|q4|q4f16; 'q8' is the legacy alias that resolves
    // to this repo's own "quantized" file (onnx/model_quantized.onnx) -- confirmed live via
    // ModelRegistry.get_files({dtype:'q8'}), matching the plan's own "quantized ≈92MB" wording
    // (the repo's own onnx/ directory also has separately-named uint8/int8 files at different
    // sizes, so the dtype string, not just "any 8-bit variant", determines which file is fetched).
    dtype: 'q8',
    family: 'tts',
    device: 'wasm',
    license: 'Apache-2.0',
    url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX',
    // Verified: onnx/model_quantized.onnx (92,361,116 B).
    approxMB: 92,
    usesPipeline: false,
  },
  {
    id: 'swin2sr-upscale',
    task: 'image-to-image',
    repo: 'onnx-community/swin2SR-realworld-sr-x4-64-bsrgan-psnr-ONNX',
    dtype: 'q4f16',
    family: 'upscale',
    device: 'webgpu',
    license: 'Apache-2.0',
    url: 'https://huggingface.co/onnx-community/swin2SR-realworld-sr-x4-64-bsrgan-psnr-ONNX',
    // Verified: onnx/model_q4f16.onnx (15,249,949 B).
    approxMB: 15,
  },
  {
    id: 'whisper-turbo',
    task: 'automatic-speech-recognition',
    repo: 'onnx-community/whisper-large-v3-turbo',
    // A per-submodule dtype DICT ({encoder_model:'q4f16', decoder_model_merged:'q4f16'}, the same
    // shape whisper-tiny/whisper-base above use) resolves the wrong files for THIS repo -- verified
    // live: it silently falls back to the full-precision encoder_model.onnx (+ .onnx_data), not
    // encoder_model_q4f16.onnx. A single dtype STRING applies q4f16 uniformly to every submodule
    // and resolves correctly (get_pipeline_files confirmed: onnx/encoder_model_q4f16.onnx +
    // onnx/decoder_model_merged_q4f16.onnx) -- used here instead, a real, repo-specific gotcha, not
    // a stylistic preference.
    dtype: 'q4f16',
    family: 'asr',
    device: 'webgpu',
    license: 'Apache-2.0',
    url: 'https://huggingface.co/onnx-community/whisper-large-v3-turbo',
    // Verified: onnx/encoder_model_q4f16.onnx (369,974,078 B) + onnx/decoder_model_merged_q4f16.onnx
    // (193,505,017 B) = 563,479,095 B, matching the plan's own "≈564MB" figure almost exactly.
    approxMB: 563,
  },
  {
    id: 'moonshine-base',
    // Dispatched by the standard AutomaticSpeechRecognitionPipeline itself (a dedicated
    // `_call_moonshine` branch keyed on `model.config.model_type === 'moonshine'`, confirmed by
    // reading pipelines/automatic-speech-recognition.js directly) -- a real pipeline task, unlike
    // Kokoro/Florence-2/VLM above. Returns only `{text}`, no chunk-level timestamps at all (no
    // `chunk_length_s`/`return_timestamps` support) -- transcribe.worker.ts branches on this at
    // runtime via the same `model.config.model_type` check, per its own module doc comment.
    task: 'automatic-speech-recognition',
    repo: 'onnx-community/moonshine-base-ONNX',
    dtype: 'q4f16',
    family: 'asr',
    device: 'webgpu',
    license: 'MIT',
    url: 'https://huggingface.co/onnx-community/moonshine-base-ONNX',
    // Verified: onnx/encoder_model_q4f16.onnx (16,638,074 B) + onnx/decoder_model_merged_q4f16.onnx
    // (85,089,526 B) = 101,727,600 B.
    approxMB: 102,
  },
  // opus-mt: one catalog id per language pair (translate_transcript's own `to` argument selects
  // one of these by src/dest language, no other mapping). All six pairs the plan names exist under
  // onnx-community (confirmed live, no Xenova/* fallback needed). Reversed pairs (en-de/de-en,
  // en-es/es-en, en-fr/fr-en) happen to share identical file sizes with their own reverse --
  // verified independently for all six repos, not assumed from one direction.
  {
    id: 'opus-mt-en-de',
    task: 'translation',
    repo: 'onnx-community/opus-mt-en-de',
    dtype: 'q4f16',
    family: 'translate',
    device: 'webgpu',
    license: 'CC-BY-4.0',
    url: 'https://huggingface.co/onnx-community/opus-mt-en-de',
    // Verified: onnx/encoder_model_q4f16.onnx (70,844,907 B) + onnx/decoder_model_merged_q4f16.onnx
    // (147,715,759 B) = 218,560,666 B. (Below the plan's own "≈240MB" estimate -- that figure fits
    // an fp16-encoder combination better; q4f16/q4f16 is smaller and still correctly resolved.)
    approxMB: 219,
  },
  {
    id: 'opus-mt-de-en',
    task: 'translation',
    repo: 'onnx-community/opus-mt-de-en',
    dtype: 'q4f16',
    family: 'translate',
    device: 'webgpu',
    license: 'CC-BY-4.0',
    url: 'https://huggingface.co/onnx-community/opus-mt-de-en',
    // Verified: identical file sizes to opus-mt-en-de above (218,560,666 B).
    approxMB: 219,
  },
  {
    id: 'opus-mt-en-es',
    task: 'translation',
    repo: 'onnx-community/opus-mt-en-es',
    dtype: 'q4f16',
    family: 'translate',
    device: 'webgpu',
    license: 'CC-BY-4.0',
    url: 'https://huggingface.co/onnx-community/opus-mt-en-es',
    // Verified: onnx/encoder_model_q4f16.onnx (77,910,507 B) + onnx/decoder_model_merged_q4f16.onnx
    // (161,874,559 B) = 239,785,066 B, matching the plan's own "≈240MB" figure almost exactly.
    approxMB: 240,
  },
  {
    id: 'opus-mt-es-en',
    task: 'translation',
    repo: 'onnx-community/opus-mt-es-en',
    dtype: 'q4f16',
    family: 'translate',
    device: 'webgpu',
    license: 'CC-BY-4.0',
    url: 'https://huggingface.co/onnx-community/opus-mt-es-en',
    // Verified: identical file sizes to opus-mt-en-es above (239,785,066 B).
    approxMB: 240,
  },
  {
    id: 'opus-mt-en-fr',
    task: 'translation',
    repo: 'onnx-community/opus-mt-en-fr',
    dtype: 'q4f16',
    family: 'translate',
    device: 'webgpu',
    license: 'CC-BY-4.0',
    url: 'https://huggingface.co/onnx-community/opus-mt-en-fr',
    // Verified: onnx/encoder_model_q4f16.onnx (72,291,819 B) + onnx/decoder_model_merged_q4f16.onnx
    // (150,615,235 B) = 222,907,054 B.
    approxMB: 223,
  },
  {
    id: 'opus-mt-fr-en',
    task: 'translation',
    repo: 'onnx-community/opus-mt-fr-en',
    dtype: 'q4f16',
    family: 'translate',
    device: 'webgpu',
    license: 'CC-BY-4.0',
    url: 'https://huggingface.co/onnx-community/opus-mt-fr-en',
    // Verified: identical file sizes to opus-mt-en-fr above (222,907,054 B).
    approxMB: 223,
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

export type TranscribeTier = 'tiny' | 'base' | 'turbo' | 'moonshine';

/** Task 13: `transcribe`'s own `model?: tiny|base|turbo|moonshine` argument maps to a catalog id
 * through this one function -- `moonshine` is its own architecture (`moonshine-base`), not a
 * `whisper-` prefix, so (unlike `resolveVlmId`'s uniform prefix) this is a real per-tier table. */
const TRANSCRIBE_TIER_TO_MODEL_ID: Record<TranscribeTier, string> = {
  tiny: 'whisper-tiny',
  base: 'whisper-base',
  turbo: 'whisper-turbo',
  moonshine: 'moonshine-base',
};

export function resolveTranscribeId(tier: TranscribeTier | undefined): string {
  return TRANSCRIBE_TIER_TO_MODEL_ID[tier ?? 'tiny'];
}

/** Task 13: `translate_transcript`'s `to`/`from` language pair maps to a catalog id -- only the
 * six pairs the plan names (`en`<->`de`/`es`/`fr`) exist in the catalog; anything else is the
 * caller's job to reject with a clear error before ever calling this. */
export function resolveTranslateId(from: string, to: string): string | undefined {
  return getCatalogEntry(`opus-mt-${from}-${to}`)?.id;
}
