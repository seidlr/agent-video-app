/**
 * Pure audio-mixing math for Task 13's voice-over feature, kept out of media/export.ts so it's
 * unit-testable on synthetic buffers without a real decode/encode pipeline -- same split as
 * media/depthStats.ts/dhash.ts. Operates on plain `Float32Array` PCM (one channel at a time);
 * export.ts is responsible for pulling channels out of/back into a real `AudioBuffer`.
 */

export interface DuckOptions {
  /** How much to attenuate the original audio under a voice-over, in dB (negative = quieter). */
  duckDb?: number;
  /** Fade duration in and out of the ducked region. */
  rampSeconds?: number;
}

const DEFAULT_DUCK_DB = -12;
const DEFAULT_RAMP_SECONDS = 0.15;

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/** Linear-interpolation resampler -- adequate for voice-over speech content at typical export
 * sample rates (Kokoro's 24kHz output -> a 44.1/48kHz export track); not a high-quality DSP
 * resampler and not meant to be one. */
export function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return samples.slice();
  const outLength = Math.round((samples.length * toRate) / fromRate);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcPos = (i * fromRate) / toRate;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = srcPos - i0;
    const s0 = samples[i0] ?? 0;
    const s1 = samples[i1] ?? 0;
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}

/** Builds a per-sample gain envelope over `length` samples at `sampleRate`: 1 outside
 * [voStartSeconds, voStartSeconds+voDurationSeconds], ramping down to the duck gain over
 * `rampSeconds` immediately before the VO starts and back up to 1 over `rampSeconds` immediately
 * after it ends, held at the duck gain for the VO's own duration. */
export function buildDuckEnvelope(
  length: number,
  sampleRate: number,
  voStartSeconds: number,
  voDurationSeconds: number,
  options: DuckOptions = {},
): Float32Array {
  const duckGain = dbToGain(options.duckDb ?? DEFAULT_DUCK_DB);
  const rampSamples = Math.max(1, Math.round((options.rampSeconds ?? DEFAULT_RAMP_SECONDS) * sampleRate));
  const voStartSample = Math.round(voStartSeconds * sampleRate);
  const voEndSample = voStartSample + Math.round(voDurationSeconds * sampleRate);

  const envelope = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    if (i < voStartSample - rampSamples) {
      envelope[i] = 1;
    } else if (i < voStartSample) {
      const t = (i - (voStartSample - rampSamples)) / rampSamples;
      envelope[i] = 1 + (duckGain - 1) * t;
    } else if (i < voEndSample) {
      envelope[i] = duckGain;
    } else if (i < voEndSample + rampSamples) {
      const t = (i - voEndSample) / rampSamples;
      envelope[i] = duckGain + (1 - duckGain) * t;
    } else {
      envelope[i] = 1;
    }
  }
  return envelope;
}

/** Mixes one voice-over onto `original` (a single channel's own samples, at `sampleRate` -- resample
 * the VO to that rate first via `resampleLinear` if it was recorded at a different one): ducks
 * `original` under the VO's own [atSeconds, atSeconds+duration] window and adds the VO on top.
 * Extends the returned buffer past `original`'s own length (zero-padded first) when the VO runs
 * past its end. A multi-channel caller applies this once per channel -- the VO itself is mono,
 * added identically to every channel. */
export function mixVoiceoverIntoChannel(
  original: Float32Array,
  sampleRate: number,
  vo: Float32Array,
  atSeconds: number,
  options: DuckOptions = {},
): Float32Array {
  const atSample = Math.round(atSeconds * sampleRate);
  const outLength = Math.max(original.length, atSample + vo.length);
  const out = new Float32Array(outLength);
  out.set(original);

  const envelope = buildDuckEnvelope(outLength, sampleRate, atSeconds, vo.length / sampleRate, options);
  for (let i = 0; i < outLength; i++) out[i] = (out[i] ?? 0) * (envelope[i] ?? 1);

  for (let i = 0; i < vo.length; i++) {
    const idx = atSample + i;
    out[idx] = (out[idx] ?? 0) + (vo[i] ?? 0);
  }
  return out;
}
