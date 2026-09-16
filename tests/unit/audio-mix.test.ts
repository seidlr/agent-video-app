import { describe, expect, it } from 'vitest';
import { buildDuckEnvelope, dbToGain, mixVoiceoverIntoChannel, resampleLinear } from '../../src/media/audioMix';

const SAMPLE_RATE = 8000;
const DUCK_DB = -12;
const RAMP_SECONDS = 0.15;

describe('dbToGain', () => {
  it('converts -12dB to the standard amplitude ratio', () => {
    expect(dbToGain(-12)).toBeCloseTo(0.2512, 4);
  });
  it('converts 0dB to unity gain', () => {
    expect(dbToGain(0)).toBe(1);
  });
});

describe('buildDuckEnvelope', () => {
  it('is 1 well before the VO starts, duckGain during it, and 1 again well after it ends', () => {
    const length = SAMPLE_RATE * 4; // 4s
    const envelope = buildDuckEnvelope(length, SAMPLE_RATE, 2, 1, { duckDb: DUCK_DB, rampSeconds: RAMP_SECONDS });
    const duckGain = dbToGain(DUCK_DB);

    expect(envelope[0]).toBe(1);
    expect(envelope[Math.round(1 * SAMPLE_RATE)]).toBe(1); // t=1s, well before the t=2s VO
    expect(envelope[Math.round(2.5 * SAMPLE_RATE)]).toBeCloseTo(duckGain, 6); // mid-VO
    expect(envelope[Math.round(3.5 * SAMPLE_RATE)]).toBe(1); // well after the VO ends (duration 1s + ramp)
  });

  it('ramps linearly over exactly 150ms before the VO starts', () => {
    const length = SAMPLE_RATE * 4;
    const envelope = buildDuckEnvelope(length, SAMPLE_RATE, 2, 1, { duckDb: DUCK_DB, rampSeconds: RAMP_SECONDS });
    const duckGain = dbToGain(DUCK_DB);
    const rampSamples = Math.round(RAMP_SECONDS * SAMPLE_RATE);
    const voStartSample = Math.round(2 * SAMPLE_RATE);

    expect(envelope[voStartSample - rampSamples]).toBeCloseTo(1, 6);
    expect(envelope[voStartSample]).toBeCloseTo(duckGain, 6); // fully ducked exactly at VO start
    const midRampIndex = voStartSample - Math.round(rampSamples / 2);
    const midGain = envelope[midRampIndex] as number;
    expect(midGain).toBeGreaterThan(duckGain);
    expect(midGain).toBeLessThan(1);
  });
});

describe('resampleLinear', () => {
  it('returns the same buffer when rates already match', () => {
    const samples = new Float32Array([0, 0.5, 1, 0.5, 0]);
    const result = resampleLinear(samples, SAMPLE_RATE, SAMPLE_RATE);
    expect(Array.from(result)).toEqual(Array.from(samples));
  });

  it('resamples a ramp to a higher rate, preserving start/end values and scaling length', () => {
    const samples = new Float32Array(100).map((_, i) => i / 99); // 0 -> 1 ramp
    const result = resampleLinear(samples, 8000, 16000);
    expect(result.length).toBe(200);
    expect(result[0]).toBeCloseTo(0, 5);
    expect(result[result.length - 1]).toBeCloseTo(1, 2);
  });
});

describe('mixVoiceoverIntoChannel (Task 13 DoD)', () => {
  it('mixes a 1s VO at t=2 into a 4s tone, applying the -12dB duck with 150ms ramps (sample-accurate)', () => {
    const toneValue = 1;
    const voValue = 0.5;
    const original = new Float32Array(SAMPLE_RATE * 4).fill(toneValue);
    const vo = new Float32Array(SAMPLE_RATE * 1).fill(voValue);

    const mixed = mixVoiceoverIntoChannel(original, SAMPLE_RATE, vo, 2, { duckDb: DUCK_DB, rampSeconds: RAMP_SECONDS });
    const duckGain = dbToGain(DUCK_DB);

    // Well before the VO: untouched tone.
    expect(mixed[Math.round(1 * SAMPLE_RATE)]).toBeCloseTo(toneValue, 6);
    // Mid-VO: fully ducked tone plus the VO sample itself.
    expect(mixed[Math.round(2.5 * SAMPLE_RATE)]).toBeCloseTo(toneValue * duckGain + voValue, 6);
    // Well after the VO ends (+ ramp): back to untouched tone, no VO contribution.
    expect(mixed[Math.round(3.5 * SAMPLE_RATE)]).toBeCloseTo(toneValue, 6);
  });

  it('extends the output past the original length when the VO runs past its end', () => {
    const original = new Float32Array(10).fill(1);
    const vo = new Float32Array(5).fill(0.5);
    const mixed = mixVoiceoverIntoChannel(original, SAMPLE_RATE, vo, 8 / SAMPLE_RATE);
    expect(mixed.length).toBe(13); // VO starts at sample 8, runs 5 samples -> ends at 13
  });
});
