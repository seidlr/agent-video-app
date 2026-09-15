import { describe, expect, it } from 'vitest';
import { dhash64, quantizeHist } from '../../src/media/dhash';
import { detectScenesFromHistograms, findSimilarRanges, type FrameSample, type SceneCandidate } from '../../src/media/scenes';

const WIDTH = 16;
const HEIGHT = 16;

function solidHist(r: number, g: number, b: number): Uint8Array {
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  return quantizeHist(rgba, WIDTH, HEIGHT);
}

/** A histogram with `fraction` of pixels colorA and the rest colorB -- distributes mass
 * continuously between exactly two of the 48 bins as `fraction` changes, unlike a solid-color
 * per-pixel blend (which stays 100% concentrated in a single bin until a color shift crosses a
 * quantization boundary, then jumps discretely). Used to simulate a real gradual visual change
 * (e.g. a wipe or fade) whose chi2 distance actually grows smoothly step to step. */
function splitHist(colorA: [number, number, number], colorB: [number, number, number], fraction: number): Uint8Array {
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  const pixelCount = WIDTH * HEIGHT;
  const splitAt = Math.round(pixelCount * fraction);
  for (let i = 0; i < pixelCount; i++) {
    const [r, g, b] = i < splitAt ? colorA : colorB;
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  return quantizeHist(rgba, WIDTH, HEIGHT);
}

describe('detectScenesFromHistograms (Task 8 DoD: scenes.test.ts)', () => {
  it('DoD: detects 3 hard cuts on synthetic histograms (matching the fixture: red/green/blue/yellow, 2s each)', () => {
    // A 0.25s candidate grid over an 8s, 4-scene video (the real fixture's own layout).
    const colors: [number, number, number][] = [
      [255, 0, 0], // red, 0-2s
      [0, 170, 0], // green, 2-4s
      [0, 0, 255], // blue, 4-6s
      [255, 221, 0], // yellow, 6-8s
    ];
    const candidates: SceneCandidate[] = [];
    for (let t = 0; t < 8; t += 0.25) {
      const sceneIndex = Math.min(3, Math.floor(t / 2));
      const [r, g, b] = colors[sceneIndex]!;
      candidates.push({ time: t, hist: solidHist(r, g, b) });
    }
    candidates.push({ time: 8, hist: solidHist(...colors[3]!) });

    const scenes = detectScenesFromHistograms(candidates);

    expect(scenes).toHaveLength(4);
    expect(scenes[0]).toEqual({ start: 0, end: 2 });
    expect(scenes[1]).toEqual({ start: 2, end: 4 });
    expect(scenes[2]).toEqual({ start: 4, end: 6 });
    expect(scenes[3]).toEqual({ start: 6, end: 8 });
  });

  it('DoD: ignores a slow fade whose per-step chi2 distance stays below threshold', () => {
    // A single scene, gradually wiping from red to blue over 4s at a fine 0.1s step -- the same
    // total color change a hard cut would make in one frame, but spread across 40 small steps so
    // no individual step looks like one.
    const candidates: SceneCandidate[] = [];
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      candidates.push({ time: i * 0.1, hist: splitHist([255, 0, 0], [0, 0, 255], i / steps) });
    }

    const scenes = detectScenesFromHistograms(candidates);

    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toEqual({ start: 0, end: 4 });
  });

  it('respects minSceneDuration by not splitting on a cut too close to the previous one', () => {
    const candidates: SceneCandidate[] = [
      { time: 0, hist: solidHist(255, 0, 0) },
      { time: 0.2, hist: solidHist(0, 255, 0) }, // a real color change, but under the 0.5s floor
      { time: 1, hist: solidHist(0, 255, 0) },
    ];
    const scenes = detectScenesFromHistograms(candidates, { minSceneDuration: 0.5 });
    expect(scenes).toHaveLength(1);
  });

  it('returns an empty array for no candidates', () => {
    expect(detectScenesFromHistograms([])).toEqual([]);
  });

  it('a higher sensitivity lowers the floor, catching a subtler change a default run would miss', () => {
    // A modest 12% split-ratio shift -- deliberately below the default 0.30 floor but above a
    // lowered one (sensitivity 0.1 -> floor 0.03).
    const candidates: SceneCandidate[] = [
      { time: 0, hist: splitHist([255, 0, 0], [0, 0, 255], 0) },
      { time: 1, hist: splitHist([255, 0, 0], [0, 0, 255], 0.12) },
    ];
    const baseline = detectScenesFromHistograms(candidates);
    const sensitive = detectScenesFromHistograms(candidates, { sensitivity: 0.1 });
    expect(baseline).toHaveLength(1); // too subtle for the default floor
    expect(sensitive.length).toBeGreaterThan(baseline.length);
  });
});

describe('findSimilarRanges (Task 8 DoD: Key Decisions ranking)', () => {
  const FRAME_WIDTH = 16;
  const FRAME_HEIGHT = 16;

  function solidRgba(r: number, g: number, b: number): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(FRAME_WIDTH * FRAME_HEIGHT * 4);
    for (let i = 0; i < FRAME_WIDTH * FRAME_HEIGHT; i++) {
      rgba[i * 4] = r;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = b;
      rgba[i * 4 + 3] = 255;
    }
    return rgba;
  }

  // Same pixel-count split as scenes.test.ts's own splitHist helper above, but returning the raw
  // RGBA buffer (not just its histogram) so a real dhash can be computed alongside it.
  function splitRgba(colorA: [number, number, number], colorB: [number, number, number], fraction: number): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(FRAME_WIDTH * FRAME_HEIGHT * 4);
    const pixelCount = FRAME_WIDTH * FRAME_HEIGHT;
    const splitAt = Math.round(pixelCount * fraction);
    for (let i = 0; i < pixelCount; i++) {
      const [r, g, b] = i < splitAt ? colorA : colorB;
      rgba[i * 4] = r;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = b;
      rgba[i * 4 + 3] = 255;
    }
    return rgba;
  }

  function sample(time: number, rgba: Uint8ClampedArray): FrameSample {
    return { time, dhash: dhash64(rgba, FRAME_WIDTH, FRAME_HEIGHT), hist: quantizeHist(rgba, FRAME_WIDTH, FRAME_HEIGHT) };
  }

  it('DoD (Key Decisions): ranks matches by hamming + 20*chi2 ascending, not by chronological order', () => {
    const query = sample(-1, solidRgba(255, 0, 0));
    // A worse (larger chi2) match placed EARLIER in time than a better (smaller chi2) match --
    // a chronological listing would put the worse match first; the required ranking must not.
    const worse = sample(0, splitRgba([255, 0, 0], [0, 0, 255], 0.8));
    const better = sample(10, splitRgba([255, 0, 0], [0, 0, 255], 0.99));

    const ranges = findSimilarRanges([worse, better], query, { maxDistance: 64, maxColorDistance: 0.25 });

    expect(ranges).toHaveLength(2);
    expect(ranges[0]!.start).toBe(10);
    expect(ranges[1]!.start).toBe(0);
  });
});
