/// <reference lib="webworker" />
/**
 * Runs Whisper speech-to-text transcription in a dedicated Worker, per the plan's Task 8 Key
 * Decisions. Mirrors segment.worker.ts's own RPC shape (postMessage keyed by request id) and
 * caching setup exactly, so ml/client.ts's shared `wrapWorker` transport works unmodified for this
 * family too.
 *
 * API confirmed directly against the installed @huggingface/transformers@4.2.0 type declarations:
 * `pipeline('automatic-speech-recognition', repo, {device, dtype, progress_callback})` returns a
 * callable `(audio: Float32Array, options) => Promise<{text, chunks?: [{timestamp:[start,end],
 * text}]}>` -- `onnx-community/whisper-tiny`/`whisper-base` (Apache-2.0, derived from OpenAI's
 * own Apache-2.0-licensed Whisper checkpoints).
 */
import type { AutomaticSpeechRecognitionOutput, AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { getCatalogEntry, type ModelDevice } from './catalog';
import { downloadProgressCallback, loadTransformers } from './transformersCdn';

// Same rate media/audio.ts's own extractAudioPcm always extracts at (its own AUDIO_SAMPLE_RATE) --
// duplicated as a literal rather than imported so this worker's tsconfig project doesn't pull in
// media/source.ts's transitively-reachable `import.meta.env` usage, which tsconfig.worker.json
// doesn't have Vite's client types for (a real, pre-existing gap, out of this task's scope to fix).
const TRANSCRIBE_SAMPLE_RATE = 16000;

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;

const CHUNK_LENGTH_S = 30;
const STRIDE_LENGTH_S = 5;

async function loadModel(modelId: string, device: ModelDevice, onProgress: (fraction: number) => void): Promise<void> {
  const entry = getCatalogEntry(modelId);
  if (!entry) throw new Error(`unknown_model: ${modelId}`);
  const { pipeline } = await loadTransformers();

  const progress_callback = downloadProgressCallback(onProgress);

  transcriber = await pipeline('automatic-speech-recognition', entry.repo, {
    device,
    dtype: entry.dtype as Record<string, 'fp16' | 'q4'>,
    progress_callback,
  });
  onProgress(1);
}

export interface TranscribedSegment {
  start: number;
  end: number;
  text: string;
  words?: { start: number; end: number; text: string }[];
}

interface WhisperChunk {
  timestamp: [number, number | null];
  text: string;
}

/** Assigns each word-level chunk to the segment it falls within (both lists are already time-
 * ordered, so a single forward-advancing pointer suffices) -- word timestamps are attached as a
 * best-effort enhancement per the plan's Key Decisions ("attach words only if the run resolves"),
 * never required for a segment to be valid. */
function attachWords(segments: TranscribedSegment[], wordChunks: WhisperChunk[]): void {
  let segIndex = 0;
  for (const chunk of wordChunks) {
    const start = chunk.timestamp[0] ?? 0;
    while (segIndex < segments.length - 1 && (segments[segIndex] as TranscribedSegment).end <= start) segIndex++;
    const segment = segments[segIndex];
    if (!segment) continue;
    const end = chunk.timestamp[1] ?? start;
    (segment.words ??= []).push({ start, end, text: chunk.text.trim() });
  }
}

/** Moonshine (Task 13) is dispatched by the same `AutomaticSpeechRecognitionPipeline` but through
 * its own `_call_moonshine` branch (confirmed by reading pipelines/automatic-speech-recognition.js
 * directly): it accepts no `chunk_length_s`/`stride_length_s`/`return_timestamps` at all and
 * returns only `{text}` -- no per-chunk timestamps, so a moonshine transcription is always exactly
 * one segment spanning the whole clip. Checking `model.config.model_type` (the same field the
 * pipeline itself switches on) at runtime, rather than a separate catalog flag, means this stays
 * correct even if a future catalog id changes without this file being touched. */
function isMoonshineModel(): boolean {
  return (transcriber?.model.config as { model_type?: string } | undefined)?.model_type === 'moonshine';
}

async function transcribe(samples: Float32Array, language: string | undefined): Promise<{ segments: TranscribedSegment[] }> {
  if (!transcriber) throw new Error('model_not_loaded: call load first');

  if (isMoonshineModel()) {
    const result = (await transcriber(samples)) as AutomaticSpeechRecognitionOutput;
    return { segments: [{ start: 0, end: samples.length / TRANSCRIBE_SAMPLE_RATE, text: result.text.trim() }] };
  }

  const result = (await transcriber(samples, {
    chunk_length_s: CHUNK_LENGTH_S,
    stride_length_s: STRIDE_LENGTH_S,
    return_timestamps: true,
    language,
  })) as AutomaticSpeechRecognitionOutput;

  const segments: TranscribedSegment[] = (result.chunks ?? []).map((chunk) => {
    const [start, rawEnd] = chunk.timestamp;
    return { start: start ?? 0, end: rawEnd ?? start ?? 0, text: chunk.text.trim() };
  });

  try {
    const wordResult = (await transcriber(samples, {
      chunk_length_s: CHUNK_LENGTH_S,
      stride_length_s: STRIDE_LENGTH_S,
      return_timestamps: 'word',
      language,
    })) as AutomaticSpeechRecognitionOutput;
    attachWords(segments, (wordResult.chunks ?? []) as WhisperChunk[]);
  } catch {
    // Word-level timestamps are a best-effort second pass; the segment-level transcription above
    // already succeeded and is returned regardless of whether this one does.
  }

  return { segments };
}

interface RpcRequest {
  id: string;
  method: 'load' | 'transcribe' | 'dispose';
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
      case 'transcribe': {
        const { samples, language } = args as { samples: Float32Array; language?: string };
        result = await transcribe(samples, language);
        break;
      }
      case 'dispose':
        transcriber = null;
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
