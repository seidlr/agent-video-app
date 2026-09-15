import { CanvasSink, EncodedPacketSink, type InputVideoTrack } from 'mediabunny';
import { chi2, dhash64, hamming, quantizeHist } from './dhash';
import { getInput } from './input';
import type { ResolvedSource } from './source';
import { getPersistedHashes, persistHashes } from '../store/hashes';

/** Downscaled decode target for scene-detection/similarity sampling -- coarse enough to be cheap
 * for every sampled frame of a long video, matching the plan's own Key Decisions exactly. */
export const SAMPLE_WIDTH = 64;
export const SAMPLE_HEIGHT = 36;
/** The dense fallback grid, in addition to every real keyframe -- catches scene changes that
 * happen to fall between two keyframes (a long GOP) without needing to decode every frame. */
export const SAMPLE_GRID_SECONDS = 0.25;

export interface FrameSample {
  time: number;
  dhash: bigint;
  hist: Uint8Array;
}

export interface SceneCandidate {
  time: number;
  hist: Uint8Array;
}

export interface SceneDetectionOptions {
  /** Scales the absolute 0.30 chi2 floor -- a higher sensitivity lowers the floor (detects
   * subtler cuts), a lower one raises it (only very hard cuts count). */
  sensitivity?: number;
  /** Two candidates closer together than this never produce a cut between them, even if their
   * chi2 distance clears the threshold -- collapses spurious near-duplicate cuts into one scene
   * boundary. */
  minSceneDuration?: number;
  /** How many recent candidate-to-candidate distances feed the adaptive mean+4sigma threshold. */
  windowSize?: number;
}

export interface Scene {
  start: number;
  end: number;
}

const DEFAULT_FLOOR = 0.3;
const DEFAULT_MIN_SCENE_DURATION = 0.5;
const DEFAULT_WINDOW_SIZE = 32;
const THRESHOLD_SIGMA_MULTIPLIER = 4;

/**
 * Pure scene-cut detection over a time-sorted sequence of (time, 48-bin color histogram) samples
 * -- the actual mediabunny decode + histogram computation lives in the impure counterpart this
 * module also exports (browser-only, needs CanvasSink), kept separate so this half is unit
 * testable against fixed, hand-built histograms per the plan's own `scenes.test.ts` DoD line.
 *
 * A cut is declared between two consecutive candidates when their chi2 color-histogram distance
 * exceeds `max(0.30 * sensitivity, mean + 4*stddev)` of a rolling window of recent distances --
 * adaptive to each video's own baseline visual volatility (a video that's naturally "busier"
 * frame-to-frame needs a bigger jump to count as a real cut) while never dropping below an
 * absolute floor for an otherwise-static video whose baseline variance is near zero. A gradual
 * fade keeps every single step's distance small (each is compared only to its immediate
 * predecessor), so accumulating drift across many small steps never itself triggers a cut --
 * exactly the "ignores a slow fade" DoD behavior, with no special-casing needed for it.
 */
export function detectScenesFromHistograms(candidates: SceneCandidate[], options: SceneDetectionOptions = {}): Scene[] {
  if (candidates.length === 0) return [];

  const sensitivity = options.sensitivity ?? 1;
  const minSceneDuration = options.minSceneDuration ?? DEFAULT_MIN_SCENE_DURATION;
  const windowSize = options.windowSize ?? DEFAULT_WINDOW_SIZE;
  const floor = DEFAULT_FLOOR * sensitivity;

  const sorted = [...candidates].sort((a, b) => a.time - b.time);
  const window: number[] = [];
  const cutTimes: number[] = [];
  let lastCutTime = sorted[0]!.time;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    const distance = chi2(prev.hist, curr.hist);

    let threshold = floor;
    if (window.length > 0) {
      const mean = window.reduce((sum, v) => sum + v, 0) / window.length;
      const variance = window.reduce((sum, v) => sum + (v - mean) ** 2, 0) / window.length;
      threshold = Math.max(floor, mean + THRESHOLD_SIGMA_MULTIPLIER * Math.sqrt(variance));
    }

    const isCut = distance > threshold && curr.time - lastCutTime >= minSceneDuration;
    if (isCut) {
      cutTimes.push(curr.time);
      lastCutTime = curr.time;
    } else {
      // Only ordinary within-scene variation feeds the rolling baseline -- a cut's own distance
      // is exactly the kind of outlier the baseline needs to stay blind to, or it inflates
      // mean/stddev enough to mask the *next* real cut (confirmed empirically: without this,
      // three back-to-back hard cuts collapsed into detecting only the first one or two).
      window.push(distance);
      if (window.length > windowSize) window.shift();
    }
  }

  const scenes: Scene[] = [];
  let sceneStart = sorted[0]!.time;
  for (const cutTime of cutTimes) {
    scenes.push({ start: sceneStart, end: cutTime });
    sceneStart = cutTime;
  }
  scenes.push({ start: sceneStart, end: sorted[sorted.length - 1]!.time });
  return scenes;
}

export interface SimilarRange {
  start: number;
  end: number;
  /** The best (smallest) hamming distance found within this range. */
  distance: number;
  /** The best (smallest) chi2 color distance found within this range. */
  colorDistance: number;
}

export interface FindSimilarOptions {
  maxDistance?: number;
  maxColorDistance?: number;
  /** Two hits farther apart than this (in seconds) start a new range instead of merging into the
   * previous one -- generous enough to bridge a stretch with only keyframe-grid coverage (no
   * dense 0.25s samples), while still splitting genuinely separate matching stretches apart. */
  maxGapSeconds?: number;
}

const DEFAULT_MAX_HAMMING = 10;
const DEFAULT_MAX_CHI2 = 0.25;
const DEFAULT_MAX_GAP_SECONDS = SAMPLE_GRID_SECONDS * 3;

/** The plan's own Key Decisions ranking rule: lower is a better match. Weighting chi2 by 20
 * reflects its [0,1] range against hamming's much wider 0-64 range -- without it, hamming (which
 * varies far more per sample) would swamp the color term that's often the only thing telling two
 * genuinely different scenes apart (see dhash.ts's own docstring on the flat-color collision). */
function rangeScore(range: SimilarRange): number {
  return range.distance + 20 * range.colorDistance;
}

/**
 * `find_similar_frames`'s combined-rule matcher: a sample counts as similar to `query` when
 * `hamming(dhash) <= maxDistance` AND `chi2(hist) <= maxColorDistance` both hold (the dHash alone
 * can't tell two different flat colors apart -- see dhash.ts's own docstring -- so the color
 * check is what actually rejects that collision). Adjacent hits (within `maxGapSeconds` of each
 * other) are merged into one contiguous range rather than reported as separate point matches, and
 * the merged ranges are finally sorted by {@link rangeScore} (best match first) rather than left
 * in chronological order, per the plan's own Key Decisions.
 */
export function findSimilarRanges(samples: FrameSample[], query: FrameSample, options: FindSimilarOptions = {}): SimilarRange[] {
  const maxDistance = options.maxDistance ?? DEFAULT_MAX_HAMMING;
  const maxColorDistance = options.maxColorDistance ?? DEFAULT_MAX_CHI2;
  const maxGapSeconds = options.maxGapSeconds ?? DEFAULT_MAX_GAP_SECONDS;

  const hits = [...samples]
    .sort((a, b) => a.time - b.time)
    .map((s) => ({ time: s.time, distance: hamming(s.dhash, query.dhash), colorDistance: chi2(s.hist, query.hist) }))
    .filter((h) => h.distance <= maxDistance && h.colorDistance <= maxColorDistance);

  if (hits.length === 0) return [];

  const ranges: SimilarRange[] = [];
  let current: SimilarRange = { start: hits[0]!.time, end: hits[0]!.time, distance: hits[0]!.distance, colorDistance: hits[0]!.colorDistance };
  for (let i = 1; i < hits.length; i++) {
    const hit = hits[i]!;
    if (hit.time - current.end <= maxGapSeconds) {
      current.end = hit.time;
      current.distance = Math.min(current.distance, hit.distance);
      current.colorDistance = Math.min(current.colorDistance, hit.colorDistance);
    } else {
      ranges.push(current);
      current = { start: hit.time, end: hit.time, distance: hit.distance, colorDistance: hit.colorDistance };
    }
  }
  ranges.push(current);
  ranges.sort((a, b) => rangeScore(a) - rangeScore(b));
  return ranges;
}

/** Every real keyframe timestamp in `sink`'s track, read via metadata-only packet retrieval (no
 * pixel decode) -- cheap even for a long video, and exactly what the plan's Key Decisions call
 * for as half of the candidate-timestamp set (the other half is the fixed 0.25s grid). */
async function collectKeyframeTimes(packetSink: EncodedPacketSink, signal?: AbortSignal): Promise<number[]> {
  const times: number[] = [];
  let packet = await packetSink.getFirstKeyPacket({ metadataOnly: true });
  while (packet) {
    signal?.throwIfAborted();
    times.push(packet.timestamp);
    packet = await packetSink.getNextKeyPacket(packet, { metadataOnly: true });
  }
  return times;
}

/**
 * The candidate timestamp set every Task 8 sampling pass decodes: every real keyframe union'd with
 * a fixed `SAMPLE_GRID_SECONDS` grid. Exported so media/embeddingSamples.ts's MobileCLIP/DINOv3
 * indexing pass samples the *same* instants as scene-detection/dHash similarity, rather than an
 * independently-computed grid -- per the plan's own "reusing the scene-detection decode pass" Key
 * Decision for `search_frames`. Needs the video's own track (obtained via `getInput`), not just a
 * `ResolvedSource`, since keyframe times come from its `EncodedPacketSink`.
 */
export async function collectSampleTimestamps(track: InputVideoTrack, duration: number, signal?: AbortSignal): Promise<number[]> {
  const packetSink = new EncodedPacketSink(track);
  const keyframeTimes = await collectKeyframeTimes(packetSink, signal);

  const gridTimes: number[] = [];
  for (let t = 0; t < duration; t += SAMPLE_GRID_SECONDS) gridTimes.push(t);

  return [...new Set([...keyframeTimes, ...gridTimes])].sort((a, b) => a - b);
}

/**
 * The impure half of scene/similarity sampling: decodes `source` at every keyframe timestamp
 * union'd with a fixed `SAMPLE_GRID_SECONDS` grid, computing a {@link FrameSample} (dHash + color
 * histogram) at each -- the actual candidate stream `detectScenesFromHistograms` and
 * `find_similar_frames` (agent/tools/vision.ts) both consume. Needs a real mediabunny decode
 * pipeline (CanvasSink/EncodedPacketSink), so unlike the pure half above this is only verified via
 * a live e2e run, not a Node unit test -- YouTube has no direct pixel access at all (Global
 * Constraints), so callers branch on `source.kind` themselves before calling this.
 */
export async function sampleFramesForAnalysis(source: ResolvedSource, options: { signal?: AbortSignal } = {}): Promise<FrameSample[]> {
  const input = await getInput(source);
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('no_video_track: this source has no video track to analyze');

  const duration = await input.computeDuration();
  const timestamps = await collectSampleTimestamps(track, duration, options.signal);

  const canvasSink = new CanvasSink(track, { width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT, fit: 'fill', poolSize: 2 });
  const samples: FrameSample[] = [];
  for await (const wrapped of canvasSink.canvasesAtTimestamps(timestamps)) {
    options.signal?.throwIfAborted();
    if (!wrapped) continue;
    const ctx = wrapped.canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!ctx) continue;
    const { data } = ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    samples.push({ time: wrapped.timestamp, dhash: dhash64(data, SAMPLE_WIDTH, SAMPLE_HEIGHT), hist: quantizeHist(data, SAMPLE_WIDTH, SAMPLE_HEIGHT) });
  }
  return samples;
}

const sampleCache = new Map<string, FrameSample[]>();

function cacheKey(source: ResolvedSource): string {
  return source.assetId ?? source.src;
}

/**
 * The one entry point `agent/tools/vision.ts`'s `detect_scenes`/`find_similar_frames` actually
 * call: an in-session cache (so repeated calls on the same source don't re-decode the whole
 * video), backed by Dexie's `hashes` table for a `kind:'file'` source (persists across a reload,
 * same as media/input.ts's own Input cache and store/frames.ts's persistence pattern) and a fresh
 * `sampleFramesForAnalysis` decode when neither has it yet.
 */
export async function ensureFrameSamples(source: ResolvedSource): Promise<FrameSample[]> {
  const key = cacheKey(source);
  const cached = sampleCache.get(key);
  if (cached) return cached;

  if (source.assetId) {
    const persisted = await getPersistedHashes(source.assetId);
    if (persisted.length > 0) {
      sampleCache.set(key, persisted);
      return persisted;
    }
  }

  const samples = await sampleFramesForAnalysis(source);
  sampleCache.set(key, samples);
  if (source.assetId) await persistHashes(source.assetId, samples);
  return samples;
}
