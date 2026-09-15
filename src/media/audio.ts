/**
 * Extracts 16kHz mono PCM audio from a local/URL source for every ML audio tool Task 8 adds
 * (Whisper transcription, pyannote speaker turns, AST audio-event tagging) -- one shared decode
 * path so each of those workers gets identical samples regardless of the source's own container/
 * codec. YouTube has no direct byte access (media/input.ts's own getInput already throws for it),
 * so callers branch on `source.kind === 'youtube'` before calling this, same as media/scenes.ts.
 */
import { BufferTarget, Conversion, Output, WavOutputFormat } from 'mediabunny';
import { getInput } from './input';
import { readLibraryFile } from '../store/library';
import type { ResolvedSource } from './source';

/** Whisper/pyannote/AST all expect 16kHz mono -- resampling once here means every downstream
 * worker can assume this rate rather than each renegotiating it. */
export const AUDIO_SAMPLE_RATE = 16000;

export interface ExtractedAudio {
  samples: Float32Array;
  sampleRate: number;
}

export interface ExtractAudioOptions {
  /** Trims the extraction to [start,end) seconds of the source, for range transcription
   * (`transcribe {from,to}`) and windowed audio-event tagging without decoding the whole file. */
  start?: number;
  end?: number;
  signal?: AbortSignal;
}

/** Walks a RIFF/WAVE buffer's chunk list to find the `data` chunk rather than assuming a fixed
 * 44-byte header -- mediabunny's Conversion copies the input's metadata tags into the output by
 * default, which (unless suppressed) can grow the header with an INFO/id3 chunk before `data`. */
export function wavDataToFloat32(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  if (view.getUint32(0, false) !== 0x52494646 /* 'RIFF' */ || view.getUint32(8, false) !== 0x57415645 /* 'WAVE' */) {
    throw new Error('invalid_wav: missing RIFF/WAVE header');
  }
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    const size = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    if (id === 'data') {
      return new Float32Array(buffer.slice(dataStart, dataStart + size));
    }
    // Chunks are word-aligned: an odd-sized chunk has one byte of padding before the next id.
    offset = dataStart + size + (size % 2);
  }
  throw new Error('invalid_wav: no data chunk found');
}

/** Reads the whole source's raw bytes -- only needed by the decodeAudioData fallback below, which
 * (unlike mediabunny's Input) has no notion of a lazy byte-range source. */
async function readSourceBytes(source: ResolvedSource): Promise<ArrayBuffer> {
  if (source.kind === 'file' && source.assetId) {
    const file = await readLibraryFile(source.assetId);
    return file.arrayBuffer();
  }
  const response = await fetch(source.src);
  return response.arrayBuffer();
}

/** SHORTCUT: the plan's own Key Decisions call for a `decodeAudioData` + `OfflineAudioContext`
 * fallback for browsers without WebCodecs audio decode (Safari < 26). This app's only supported/
 * tested browser is Chromium (playwright.config.ts), which always takes the Conversion path above,
 * so this fallback has no automated coverage here -- upgrade trigger: adding Safari to the
 * supported-browser matrix (Task 14 or later), at which point it needs a real WebKit e2e run. */
async function extractViaDecodeAudioData(source: ResolvedSource, options: ExtractAudioOptions): Promise<ExtractedAudio> {
  const bytes = await readSourceBytes(source);
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(bytes);
  } finally {
    await decodeCtx.close();
  }

  const start = Math.max(0, options.start ?? 0);
  const end = Math.min(decoded.duration, options.end ?? decoded.duration);
  const durationSeconds = Math.max(0, end - start);
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(durationSeconds * AUDIO_SAMPLE_RATE), AUDIO_SAMPLE_RATE);
  const bufferSource = offlineCtx.createBufferSource();
  bufferSource.buffer = decoded;
  bufferSource.connect(offlineCtx.destination);
  bufferSource.start(0, start, durationSeconds);
  const rendered = await offlineCtx.startRendering();
  return { samples: rendered.getChannelData(0).slice(), sampleRate: AUDIO_SAMPLE_RATE };
}

/**
 * Decodes `source`'s audio track to 16kHz mono Float32 PCM via mediabunny's `Conversion` (video
 * discarded, WAV/pcm-f32 output so no lossy codec is involved), falling back to `decodeAudioData`
 * when the environment can't drive WebCodecs audio decode. `no_audio_track` is returned as a
 * thrown error (not a mediabunny-internal one) when the source simply has no audio to extract.
 */
export async function extractAudioPcm(source: ResolvedSource, options: ExtractAudioOptions = {}): Promise<ExtractedAudio> {
  const input = await getInput(source);
  const audioTrack = await input.getPrimaryAudioTrack();
  if (!audioTrack) throw new Error('no_audio_track: this source has no audio track to analyze');

  const output = new Output({ format: new WavOutputFormat(), target: new BufferTarget() });
  const conversion = await Conversion.init({
    input,
    output,
    video: { discard: true },
    audio: { sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: 1, sampleFormat: 'f32', codec: 'pcm-f32' },
    trim: options.start !== undefined || options.end !== undefined ? { start: options.start, end: options.end } : undefined,
    tags: {}, // suppress input-metadata copying so the WAV header stays minimal (belt-and-braces
    // alongside wavDataToFloat32's own chunk walk above, which doesn't depend on this anyway).
  });

  const usesConversion = conversion.isValid && conversion.discardedTracks.every((d) => d.reason === 'discarded_by_user');
  if (!usesConversion) {
    return extractViaDecodeAudioData(source, options);
  }

  await conversion.execute({ pauseSignal: undefined });
  options.signal?.throwIfAborted();
  const buffer = output.target.buffer;
  if (!buffer) throw new Error('no_audio: conversion produced no output buffer');
  return { samples: wavDataToFloat32(buffer), sampleRate: AUDIO_SAMPLE_RATE };
}
