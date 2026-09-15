/// <reference lib="webworker" />
/**
 * Runs pyannote speaker diarization (`find_speaker_turns`) and AST audio-event tagging
 * (`tag_audio_events`) in a dedicated Worker, per the plan's Task 8 Key Decisions. Mirrors
 * segment.worker.ts's own RPC shape and caching setup exactly.
 *
 * pyannote-segmentation-3.0 has no corresponding transformers.js `pipeline()` task (confirmed by
 * its own modeling_pyannote.d.ts documentation, which loads it via `AutoModelForAudioFrameClassification`
 * + `AutoProcessor` directly, not `pipeline(...)`); AST is a normal `pipeline('audio-classification',
 * ...)` model. Both models' `preprocessor_config.json` confirm `sampling_rate:16000`, matching
 * media/audio.ts's own fixed 16kHz PCM extraction exactly -- no resampling needed in this worker.
 */
import { AutoModelForAudioFrameClassification, AutoProcessor, env, pipeline } from '@huggingface/transformers';
import type { AudioClassificationPipeline, PreTrainedModel, Processor } from '@huggingface/transformers';
import { getCatalogEntry, type ModelDevice } from './catalog';

env.useBrowserCache = true;
env.cacheKey = 'agent-video-studio-models';
env.useWasmCache = true;

/** `PyAnnoteProcessor`'s own `post_process_speaker_diarization` isn't part of the package's public
 * type-level export surface to import and cast to directly (same situation as segment.worker.ts's
 * own `MaskProcessor` narrowing) -- this narrows the one method actually used. */
interface DiarizationProcessor extends Processor {
  post_process_speaker_diarization(
    logits: unknown,
    numSamples: number,
  ): { id: number; start: number; end: number; confidence: number }[][];
}

let diarizationModel: PreTrainedModel | null = null;
let diarizationProcessor: DiarizationProcessor | null = null;
let audioClassifier: AudioClassificationPipeline | null = null;

async function loadModel(modelId: string, device: ModelDevice, onProgress: (fraction: number) => void): Promise<void> {
  const entry = getCatalogEntry(modelId);
  if (!entry) throw new Error(`unknown_model: ${modelId}`);

  const progress_callback = (event: { status: string; loaded?: number; total?: number }): void => {
    if (event.status === 'progress' && event.total) onProgress((event.loaded ?? 0) / event.total);
  };

  if (modelId === 'pyannote-segmentation') {
    diarizationModel = await AutoModelForAudioFrameClassification.from_pretrained(entry.repo, {
      dtype: entry.dtype as 'q8',
      device,
      progress_callback,
    });
    diarizationProcessor = (await AutoProcessor.from_pretrained(entry.repo)) as DiarizationProcessor;
  } else {
    audioClassifier = await pipeline('audio-classification', entry.repo, { device, dtype: entry.dtype as 'q4f16', progress_callback });
  }
  onProgress(1);
}

export interface SpeakerSegmentResult {
  id: number;
  start: number;
  end: number;
  confidence: number;
}

async function findSpeakerTurns(samples: Float32Array): Promise<SpeakerSegmentResult[]> {
  if (!diarizationModel || !diarizationProcessor) throw new Error('model_not_loaded: call load first');
  const inputs = await diarizationProcessor(samples);
  const { logits } = (await diarizationModel(inputs)) as { logits: unknown };
  const [segments] = diarizationProcessor.post_process_speaker_diarization(logits, samples.length);
  return segments ?? [];
}

const AUDIO_EVENT_SAMPLE_RATE = 16000;
const AUDIO_EVENT_WINDOW_SECONDS = 10;
const AUDIO_EVENT_HOP_SECONDS = 5;
const AUDIO_EVENT_TOP_K = 3;

export interface AudioEventResult {
  start: number;
  end: number;
  label: string;
  score: number;
}

/** Classifies overlapping 10s windows (5s hop, matching AST's own 1024-mel-frame ~10.24s native
 * input length) across the whole clip, keeping each window's top-3 labels at or above `threshold`
 * -- adjacent-window merging of repeated labels happens in media/audioEvents.ts, on the main
 * thread, since it's pure and needs no model access. */
async function tagAudioEvents(samples: Float32Array, threshold: number): Promise<AudioEventResult[]> {
  if (!audioClassifier) throw new Error('model_not_loaded: call load first');

  const windowSize = AUDIO_EVENT_WINDOW_SECONDS * AUDIO_EVENT_SAMPLE_RATE;
  const hopSize = AUDIO_EVENT_HOP_SECONDS * AUDIO_EVENT_SAMPLE_RATE;
  const results: AudioEventResult[] = [];

  for (let start = 0; start < samples.length; start += hopSize) {
    const end = Math.min(samples.length, start + windowSize);
    const slice = samples.subarray(start, end);
    if (slice.length === 0) break;

    const predictions = await audioClassifier(slice, { top_k: AUDIO_EVENT_TOP_K });
    const list = (Array.isArray(predictions) ? predictions : [predictions]) as { label: string; score: number }[];
    for (const p of list) {
      if (p.score >= threshold) {
        results.push({ start: start / AUDIO_EVENT_SAMPLE_RATE, end: end / AUDIO_EVENT_SAMPLE_RATE, label: p.label, score: p.score });
      }
    }

    if (end === samples.length) break;
  }

  return results;
}

interface RpcRequest {
  id: string;
  method: 'load' | 'find_speaker_turns' | 'tag_audio_events' | 'dispose';
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
      case 'find_speaker_turns': {
        const { samples } = args as { samples: Float32Array };
        result = await findSpeakerTurns(samples);
        break;
      }
      case 'tag_audio_events': {
        const { samples, threshold } = args as { samples: Float32Array; threshold?: number };
        result = await tagAudioEvents(samples, threshold ?? 0.3);
        break;
      }
      case 'dispose':
        diarizationModel = null;
        diarizationProcessor = null;
        audioClassifier = null;
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
