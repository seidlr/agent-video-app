/// <reference lib="webworker" />
/**
 * Runs Kokoro text-to-speech (Task 13 Key Decisions) in a dedicated Worker, via the `kokoro-js`
 * package's own `KokoroTTS` class rather than transformers.js `pipeline()` (no TTS pipeline task
 * exists) -- loaded from the CDN (kokoroCdn.ts) for the same reason every other ML worker loads
 * @huggingface/transformers from the CDN, plus a second, kokoro-js-specific reason: see
 * kokoroCdn.ts's own module doc comment.
 */
import { getCatalogEntry } from './catalog';
import { loadKokoro } from './kokoroCdn';

type KokoroDevice = 'wasm' | 'webgpu' | 'cpu';
type KokoroDtype = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';

let kokoro: import('kokoro-js').KokoroTTS | null = null;

async function loadModel(modelId: string, device: KokoroDevice, onProgress: (fraction: number) => void): Promise<void> {
  const entry = getCatalogEntry(modelId);
  if (!entry) throw new Error(`unknown_model: ${modelId}`);
  const { KokoroTTS } = await loadKokoro();

  const progress_callback = (event: { status: string; loaded?: number; total?: number }): void => {
    if (event.status === 'progress' && event.total) onProgress((event.loaded ?? 0) / event.total);
  };

  kokoro = await KokoroTTS.from_pretrained(entry.repo, {
    dtype: entry.dtype as KokoroDtype,
    device,
    progress_callback,
  });
  onProgress(1);
}

interface GenerateResult {
  /** WAV bytes via kokoro-js's own `RawAudio.toWav()` -- simpler than reinventing PCM->WAV
   * encoding here, and the tool layer already has a WAV->Float32Array decoder
   * (media/audio.ts's `wavDataToFloat32`) for audioMix.ts's own mixing pass at export time. */
  wav: ArrayBuffer;
  durationSeconds: number;
}

async function generate(text: string, voice: string, speed: number): Promise<GenerateResult> {
  if (!kokoro) throw new Error('model_not_loaded: call load first');
  const raw = await kokoro.generate(text, { voice: voice as never, speed });
  return { wav: raw.toWav(), durationSeconds: raw.audio.length / raw.sampling_rate };
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
        const { modelId, device } = args as { modelId: string; device: KokoroDevice };
        await loadModel(modelId, device, (fraction) => {
          self.postMessage({ type: 'progress', fraction });
        });
        result = undefined;
        break;
      }
      case 'generate': {
        const { text, voice, speed } = args as { text: string; voice?: string; speed?: number };
        result = await generate(text, voice ?? 'af_heart', speed ?? 1);
        break;
      }
      case 'dispose':
        kokoro = null;
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
