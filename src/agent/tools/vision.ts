import { getMlQueryOverrides, mlClient, type MlWorker } from '../../ml/client';
import { getCatalogEntry, pickDetectModel, pickSegmentModel } from '../../ml/catalog';
import { dilatePixelBox, getTracker, toGrayscale, trackFrames, type GrayFrame, type PixelBox } from '../../ml/tracker';
import { dhash64, quantizeHist } from '../../media/dhash';
import { sampleBitmapsForEmbedding } from '../../media/embeddingSamples';
import { findTopRanges } from '../../media/embeddingSearch';
import {
  detectScenesFromHistograms,
  ensureFrameSamples,
  findSimilarRanges,
  SAMPLE_HEIGHT,
  SAMPLE_WIDTH,
  type FrameSample,
} from '../../media/scenes';
import type { BoxSource } from '../../lib/types';
import { parseTime, secsToTimecode } from '../../lib/time';
import { getVideoElement } from '../../lib/videoElement';
import { persistBox, persistTrack } from '../../store/boxes';
import { getPersistedEmbeddings, persistEmbeddings, type StoredEmbedding } from '../../store/embeddings';
import type { StudioStore } from '../../store/studio';
import type { Registry, ToolCallContext, ToolResult } from '../registry';
import type { ResolvedSource } from '../../media/source';

interface SegmentPoint {
  x: number;
  y: number;
  label?: 0 | 1;
}

// Intersected with Record<string, unknown> (rather than plain interfaces) so these satisfy
// registry.define's `TArgs extends Record<string, unknown>` constraint directly.
type SegmentArgs = {
  time?: string | number;
  points?: SegmentPoint[];
  box?: { x: number; y: number; w: number; h: number };
  label?: string;
  confirmDownload?: boolean;
  stay?: boolean;
} & Record<string, unknown>;

interface SegmentWorkerResult {
  maskPng: Blob;
  box: { x: number; y: number; w: number; h: number };
  score: number;
}

type DetectObjectsResult = { label: string; score: number; box: { x: number; y: number; w: number; h: number } }[];

type TrackArgs = {
  boxId: string;
  until?: string | number;
  stepSeconds?: number;
  method?: string;
} & Record<string, unknown>;

/**
 * vision tools: segment, track. Both `local` (need direct pixel access) and job-mode (real ML
 * inference/multi-step tracking can take a while). `detect_*`/`find_similar_frames` are Task 8's.
 */
export function defineVisionTools(registry: Registry, store: StudioStore): void {
  registry.define<SegmentArgs>({
    name: 'segment',
    description:
      'Segments an object at a point or box prompt (EdgeTAM on WebGPU, SlimSAM on wasm), adding the resulting mask + tight bounding box as a new box. First call without confirmDownload to see the model size.',
    inputSchema: {
      type: 'object',
      properties: {
        time: { type: ['string', 'number'] },
        points: {
          type: 'array',
          items: {
            type: 'object',
            properties: { x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 }, label: { type: 'integer', enum: [0, 1] } },
            required: ['x', 'y'],
          },
        },
        box: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
          required: ['x', 'y', 'w', 'h'],
        },
        label: { type: 'string' },
        confirmDownload: { type: 'boolean' },
        stay: { type: 'boolean' },
      },
    },
    group: 'vision',
    when: 'local',
    mode: 'job',
    handler: async (args): Promise<ToolResult> => {
      const state = store.getState();
      if (!state.source) return { ok: false, error: 'no_video_loaded' };
      if (state.source.kind === 'youtube') {
        return { ok: false, error: 'segment_unavailable_on_youtube', hint: 'Segmentation needs direct pixel access; not available for a YouTube source.' };
      }
      if (!args.points?.length && !args.box) return { ok: false, error: 'invalid_prompt', hint: 'Provide `points` (normalized [0,1]) or a `box`.' };

      const video = getVideoElement();
      if (!video) return { ok: false, error: 'video_not_ready' };

      const modelEntry = pickSegmentModel(state.capabilities.webgpu, getMlQueryOverrides().forceWasm);
      const ensured = await mlClient.ensureModel(modelEntry.id, {
        confirmDownload: args.confirmDownload,
        onProgress: (fraction) => store.getState().setModelState(modelEntry.id, { progress: fraction }),
      });
      if (!ensured.ok) {
        if (ensured.error === 'unknown_model') return { ok: false, error: 'unknown_model', hint: `no model with id "${modelEntry.id}"` };
        return { ok: false, error: ensured.error, hint: ensured.hint };
      }
      store.getState().setModelState(modelEntry.id, { loaded: true, cached: true, progress: 1 });

      let previousTime: number | undefined;
      if (args.time !== undefined) {
        const target = parseTime(args.time, { currentTime: state.player.currentTime, duration: state.player.duration, fps: state.player.fps });
        if (target === null) return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };
        previousTime = state.player.currentTime;
        await store.getState().seek(target);
      }

      const bitmap = await createImageBitmap(video);
      let result: SegmentWorkerResult;
      try {
        const prompt = args.points
          ? { points: args.points.map((p) => ({ x: p.x, y: p.y, label: p.label ?? 1 })) }
          : { box: args.box };
        result = await ensured.worker.call<SegmentWorkerResult>('segment', { bitmap, prompt });
      } finally {
        bitmap.close();
      }

      const capturedAt = video.currentTime;
      if (previousTime !== undefined && !args.stay) await store.getState().seek(previousTime);

      const label = args.label ?? 'segment';
      const source: BoxSource = 'segment';
      const boxId = store.getState().addBox({ time: capturedAt, x: result.box.x, y: result.box.y, w: result.box.w, h: result.box.h, label, source });
      // The box's own id doubles as its mask's lookup key -- see store/boxes.ts's getPersistedBoxMask.
      await persistBox({ id: boxId, time: capturedAt, x: result.box.x, y: result.box.y, w: result.box.w, h: result.box.h, label, source, maskBlob: result.maskPng });

      return {
        ok: true,
        summary: `Segmented "${label}" at ${secsToTimecode(capturedAt)} (score ${result.score.toFixed(2)})`,
        boxId,
        box: result.box,
        score: result.score,
      };
    },
  });

  registry.define<TrackArgs>({
    name: 'track',
    description:
      'Tracks an existing box forward in time using template matching (NCC by default), producing keyframes the timeline interpolates between.',
    inputSchema: {
      type: 'object',
      properties: {
        boxId: { type: 'string' },
        until: { type: ['string', 'number'] },
        stepSeconds: { type: 'number', minimum: 0.05 },
        method: { type: 'string' },
      },
      required: ['boxId'],
    },
    group: 'vision',
    when: 'local',
    mode: 'job',
    handler: async (args): Promise<ToolResult> => {
      const state = store.getState();
      if (!state.source) return { ok: false, error: 'no_video_loaded' };
      if (state.source.kind === 'youtube') {
        return { ok: false, error: 'track_unavailable_on_youtube', hint: 'Tracking needs direct pixel access; not available for a YouTube source.' };
      }

      const box = state.boxes.find((b) => b.id === args.boxId);
      if (!box) return { ok: false, error: 'unknown_box', hint: `no box with id "${args.boxId}"` };

      const methodName = args.method ?? 'ncc';
      if (!getTracker(methodName)) {
        return { ok: false, error: 'method_unavailable', hint: `no "${methodName}" tracker registered -- load the DINOv3 model (Task 8) first, or omit method to use "ncc".` };
      }

      const video = getVideoElement();
      if (!video) return { ok: false, error: 'video_not_ready' };

      const timeCtx = { currentTime: state.player.currentTime, duration: state.player.duration, fps: state.player.fps };
      const until = args.until !== undefined ? parseTime(args.until, timeCtx) : box.time + 5;
      if (until === null) return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };
      if (until <= box.time) return { ok: false, error: 'invalid_range', hint: '`until` must be after the box\'s own time.' };

      const stepSeconds = args.stepSeconds ?? 0.5;
      const timestamps: number[] = [];
      for (let t = box.time; t <= until + 1e-9; t += stepSeconds) timestamps.push(t);
      if (timestamps.length < 2) return { ok: false, error: 'invalid_range', hint: '`until` must be at least one stepSeconds after the box time.' };

      const startedAt = performance.now();
      const frames: GrayFrame[] = [];
      for (const t of timestamps) {
        await store.getState().seek(Math.min(t, state.player.duration || t));
        const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
        const ctx = canvas.getContext('2d');
        if (!ctx) return { ok: false, error: 'video_not_ready', hint: 'Could not get a 2D context to sample frames.' };
        ctx.drawImage(video, 0, 0);
        const { data } = ctx.getImageData(0, 0, video.videoWidth, video.videoHeight);
        frames.push(toGrayscale(data, video.videoWidth, video.videoHeight));
      }
      const msPerStep = frames.length > 1 ? (performance.now() - startedAt) / (frames.length - 1) : 0;

      const tightBox: PixelBox = {
        x: Math.round(box.x * video.videoWidth),
        y: Math.round(box.y * video.videoHeight),
        w: Math.round(box.w * video.videoWidth),
        h: Math.round(box.h * video.videoHeight),
      };
      // Dilated 10% per side, matching the plan's own Key Decisions -- see dilatePixelBox's own
      // comment for why the NCC template needs this and a tight segment()/detect() box doesn't.
      const pixelBox = dilatePixelBox(tightBox, 0.1, video.videoWidth, video.videoHeight);

      const result = trackFrames(frames, pixelBox, { strategy: methodName });

      const trackId = store.getState().addTrack({ boxIds: [args.boxId], keyframes: [] });
      const keyframes = result.keyframes.map((kf) => {
        const time = timestamps[kf.index] as number;
        const normalized = { x: kf.box.x / video.videoWidth, y: kf.box.y / video.videoHeight, w: kf.box.w / video.videoWidth, h: kf.box.h / video.videoHeight };
        store.getState().appendTrackKeyframe(trackId, { time, box: normalized });
        return { time, box: normalized };
      });
      const savedTrack = store.getState().tracks.find((t) => t.id === trackId);
      if (savedTrack) await persistTrack(savedTrack);

      // BoxOverlay.tsx interpolates from the track instead of the box's own static coordinates
      // once both trackId and until are set -- until extends the box's visibility window
      // (lib/boxVisibility.ts) across the whole tracked range, not just its original point.
      const lastKeyframeTime = keyframes[keyframes.length - 1]?.time ?? box.time;
      store.getState().updateBox(args.boxId, { trackId, until: lastKeyframeTime });

      await store.getState().seek(box.time);

      if (result.reason === 'low_confidence' && result.stoppedAt !== undefined) {
        const stoppedAtTime = timestamps[result.stoppedAt] as number;
        return {
          ok: true,
          summary: `Tracked ${keyframes.length} keyframe(s), stopped at ${secsToTimecode(stoppedAtTime)} (low confidence)`,
          trackId,
          keyframes,
          stoppedAt: stoppedAtTime,
          reason: 'low_confidence',
          msPerStep,
        };
      }

      return {
        ok: true,
        summary: `Tracked ${keyframes.length} keyframe(s) from ${secsToTimecode(box.time)} to ${secsToTimecode(until)}`,
        trackId,
        keyframes,
        msPerStep,
      };
    },
  });

  registry.define<{ addChapters?: boolean; sensitivity?: number; minSceneDuration?: number }>({
    name: 'detect_scenes',
    description: 'Detects scene/shot boundaries via color histogram analysis. Optionally adds a chapter ("Scene N") per detected scene.',
    inputSchema: {
      type: 'object',
      properties: {
        addChapters: { type: 'boolean' },
        sensitivity: { type: 'number', minimum: 0.01 },
        minSceneDuration: { type: 'number', minimum: 0 },
      },
    },
    group: 'vision',
    when: 'local',
    mode: 'job',
    handler: async (args): Promise<ToolResult> => {
      const state = store.getState();
      if (!state.source) return { ok: false, error: 'no_video_loaded' };
      if (state.source.kind === 'youtube') {
        return { ok: false, error: 'scenes_unavailable_on_youtube', hint: 'Scene detection needs direct pixel access; not available for a YouTube source.' };
      }

      const samples = await ensureFrameSamples(state.source);
      const scenes = detectScenesFromHistograms(samples, { sensitivity: args.sensitivity, minSceneDuration: args.minSceneDuration });

      let chaptersAdded = 0;
      if (args.addChapters) {
        scenes.forEach((scene, index) => {
          try {
            store.getState().addChapter({ start: scene.start, end: scene.end, title: `Scene ${index + 1}` });
            chaptersAdded++;
          } catch {
            // Overlaps an existing chapter -- skip it rather than fail the whole detection result.
          }
        });
      }

      return {
        ok: true,
        summary: `Detected ${scenes.length} scene(s)${chaptersAdded > 0 ? `, added ${chaptersAdded} chapter(s)` : ''}`,
        scenes,
      };
    },
  });

  registry.define<{
    frameId?: string;
    time?: string | number;
    maxDistance?: number;
    maxColorDistance?: number;
    method?: 'hash' | 'dino';
    minScore?: number;
    confirmDownload?: boolean;
  }>({
    name: 'find_similar_frames',
    description:
      'Finds time ranges visually similar to a reference frame (by captured frameId or a timestamp). Default `method:"hash"` uses a color-aware perceptual hash (no model download); `method:"dino"` uses DINOv3 patch-feature cosine similarity, more robust to lighting/angle changes but needs a model download.',
    inputSchema: {
      type: 'object',
      properties: {
        frameId: { type: 'string' },
        time: { type: ['string', 'number'] },
        maxDistance: { type: 'number', minimum: 0 },
        maxColorDistance: { type: 'number', minimum: 0 },
        method: { type: 'string', enum: ['hash', 'dino'] },
        minScore: { type: 'number', minimum: 0, maximum: 1 },
        confirmDownload: { type: 'boolean' },
      },
    },
    annotations: { readOnlyHint: true },
    group: 'vision',
    when: 'local',
    mode: 'job',
    handler: async (args, ctx): Promise<ToolResult> => {
      const state = store.getState();
      if (!state.source) return { ok: false, error: 'no_video_loaded' };
      if (state.source.kind === 'youtube') {
        return { ok: false, error: 'find_similar_frames_unavailable_on_youtube', hint: 'Needs direct pixel access; not available for a YouTube source.' };
      }
      if (args.frameId === undefined && args.time === undefined) {
        return { ok: false, error: 'invalid_query', hint: 'Provide `frameId` (a captured frame) or `time`.' };
      }

      if (args.method === 'dino') {
        return findSimilarByDino(store, args as { frameId?: string; time?: string | number; minScore?: number; confirmDownload?: boolean }, ctx);
      }

      const samples = await ensureFrameSamples(state.source);
      if (samples.length === 0) return { ok: false, error: 'no_samples', hint: 'Nothing could be sampled from this source.' };

      let query: FrameSample;
      if (args.frameId !== undefined) {
        const frame = state.frames.find((f) => f.id === args.frameId);
        if (!frame) return { ok: false, error: 'unknown_frame', hint: `no frame with id "${args.frameId}"` };
        query = await hashFromImageUrl(frame.blobUrl);
      } else {
        const target = parseTime(args.time as string | number, { currentTime: state.player.currentTime, duration: state.player.duration, fps: state.player.fps });
        if (target === null) return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };
        query = samples.reduce((best, s) => (Math.abs(s.time - target) < Math.abs(best.time - target) ? s : best), samples[0] as FrameSample);
      }

      const ranges = findSimilarRanges(samples, query, { maxDistance: args.maxDistance, maxColorDistance: args.maxColorDistance });
      return { ok: true, summary: `${ranges.length} matching range(s)`, ranges };
    },
  });

  registry.define<{ query: string; topK?: number; minScore?: number; confirmDownload?: boolean }>({
    name: 'search_frames',
    description:
      'Finds time ranges matching a natural-language description (MobileCLIP text-to-image search), e.g. "a solid red image" or "a person talking". First call without confirmDownload to see the model size; the first call for a given video also builds its search index (may take a while for a long video).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        topK: { type: 'integer', minimum: 1 },
        minScore: { type: 'number', minimum: 0, maximum: 1 },
        confirmDownload: { type: 'boolean' },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true },
    group: 'vision',
    when: 'local',
    mode: 'job',
    handler: async (args, ctx): Promise<ToolResult> => {
      const state = store.getState();
      if (!state.source) return { ok: false, error: 'no_video_loaded' };
      if (state.source.kind === 'youtube') {
        return { ok: false, error: 'search_frames_unavailable_on_youtube', hint: 'Needs direct pixel access; not available for a YouTube source.' };
      }
      if (!args.query.trim()) return { ok: false, error: 'invalid_query', hint: '`query` must not be empty' };

      const indexed = await ensureEmbeddingIndex(state.source, 'mobileclip', 'mobileclip-s0', store, args.confirmDownload, ctx);
      if (!indexed.ok) return indexed.result;

      const queryVector = await indexed.worker.call<Float32Array>('embed_text', { query: args.query });
      // Verified empirically against the real model+fixture (see the plan's own Task 8
      // Deviations entry): MobileCLIP-S0's raw cosine similarities on this app's own sampled
      // frames cluster far lower than typical CLIP-benchmark numbers -- a genuinely relevant
      // match lands around 0.10-0.15, an irrelevant one around 0.00-0.07. 0.2 (a more standard
      // CLIP relevance threshold) filtered out every result, including correct ones.
      const ranges = findTopRanges(indexed.samples, queryVector, { minScore: args.minScore ?? 0.08 });
      const topK = args.topK ?? 5;
      return { ok: true, summary: `${Math.min(ranges.length, topK)} matching range(s)`, ranges: ranges.slice(0, topK) };
    },
  });

  registry.define<{ time?: string | number; labels?: string[]; threshold?: number; addBoxes?: boolean; confirmDownload?: boolean }>({
    name: 'detect_objects',
    description:
      'Detects objects in a frame: closed-set (RF-DETR-nano on WebGPU / YOLOS-tiny on wasm) by default, or zero-shot (Grounding-DINO) when `labels` is given (e.g. ["a red car", "a person"]). First call without confirmDownload to see the model size.',
    inputSchema: {
      type: 'object',
      properties: {
        time: { type: ['string', 'number'] },
        labels: { type: 'array', items: { type: 'string' } },
        threshold: { type: 'number', minimum: 0, maximum: 1 },
        addBoxes: { type: 'boolean' },
        confirmDownload: { type: 'boolean' },
      },
    },
    group: 'vision',
    when: 'local',
    mode: 'job',
    handler: async (args): Promise<ToolResult> => {
      const state = store.getState();
      if (!state.source) return { ok: false, error: 'no_video_loaded' };
      if (state.source.kind === 'youtube') {
        return { ok: false, error: 'detect_objects_unavailable_on_youtube', hint: 'Needs direct pixel access; not available for a YouTube source.' };
      }

      const video = getVideoElement();
      if (!video) return { ok: false, error: 'video_not_ready' };

      const zeroShot = !!args.labels?.length;
      const modelEntry = zeroShot ? getCatalogEntry('grounding-dino-tiny')! : pickDetectModel(state.capabilities.webgpu, getMlQueryOverrides().forceWasm);
      const ensured = await mlClient.ensureModel(modelEntry.id, {
        confirmDownload: args.confirmDownload,
        onProgress: (fraction) => store.getState().setModelState(modelEntry.id, { progress: fraction }),
      });
      if (!ensured.ok) {
        if (ensured.error === 'unknown_model') return { ok: false, error: 'unknown_model', hint: `no model with id "${modelEntry.id}"` };
        return { ok: false, error: ensured.error, hint: ensured.hint };
      }
      store.getState().setModelState(modelEntry.id, { loaded: true, cached: true, progress: 1 });

      let previousTime: number | undefined;
      if (args.time !== undefined) {
        const target = parseTime(args.time, { currentTime: state.player.currentTime, duration: state.player.duration, fps: state.player.fps });
        if (target === null) return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };
        previousTime = state.player.currentTime;
        await store.getState().seek(target);
      }

      const bitmap = await createImageBitmap(video);
      let detections: DetectObjectsResult;
      try {
        detections = await ensured.worker.call<DetectObjectsResult>('detect', { bitmap, labels: args.labels, threshold: args.threshold });
      } finally {
        bitmap.close();
      }

      const capturedAt = video.currentTime;
      if (previousTime !== undefined) await store.getState().seek(previousTime);

      let boxIds: string[] = [];
      if (args.addBoxes) {
        const source: BoxSource = 'detect';
        boxIds = detections.map((d) =>
          store.getState().addBox({ time: capturedAt, x: d.box.x, y: d.box.y, w: d.box.w, h: d.box.h, label: d.label, source }),
        );
      }

      return {
        ok: true,
        summary: `${detections.length} detection(s) at ${secsToTimecode(capturedAt)}${zeroShot ? ` for "${args.labels!.join(', ')}"` : ''}`,
        detections,
        boxIds: args.addBoxes ? boxIds : undefined,
      };
    },
  });
}

/** Decodes an image URL (a Frames-tray blob URL) into a {@link FrameSample} at the same
 * SAMPLE_WIDTH x SAMPLE_HEIGHT every video-decoded sample uses, so a captured frame can be
 * compared apples-to-apples against the sampled grid in `find_similar_frames {frameId}`. */
async function hashFromImageUrl(url: string): Promise<FrameSample> {
  const blob = await fetch(url).then((r) => r.blob());
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(SAMPLE_WIDTH, SAMPLE_HEIGHT);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  ctx.drawImage(bitmap, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
  return { time: -1, dhash: dhash64(data, SAMPLE_WIDTH, SAMPLE_HEIGHT), hist: quantizeHist(data, SAMPLE_WIDTH, SAMPLE_HEIGHT) };
}

type EmbeddingIndexResult = { ok: true; samples: StoredEmbedding[]; worker: MlWorker } | { ok: false; result: ToolResult };

/** In-session cache (same shape as media/scenes.ts's own `ensureFrameSamples`), keyed by source
 * identity + which model's index this is -- MobileCLIP's and DINOv3's indexes are built and cached
 * independently since a call to one tool shouldn't force-build the other's. */
const embeddingIndexCache = new Map<string, StoredEmbedding[]>();

function embeddingCacheKey(source: ResolvedSource, kind: 'mobileclip' | 'dino'): string {
  return `${source.assetId ?? source.src}:${kind}`;
}

/**
 * The one entry point `search_frames`/`find_similar_frames {method:'dino'}` both call: gates on
 * `confirmDownload` for `modelId`, then returns an already-built index from the in-session cache
 * or Dexie, or builds a fresh one by decoding every candidate frame (media/embeddingSamples.ts,
 * reusing scene-detection's own timestamp set) and embedding each through the now-resident
 * worker -- mirroring `ensureFrameSamples`'s own cache-then-Dexie-then-decode order, extended with
 * the model-loading gate neither dHash nor histogram sampling need.
 */
async function ensureEmbeddingIndex(
  source: ResolvedSource,
  kind: 'mobileclip' | 'dino',
  modelId: string,
  store: StudioStore,
  confirmDownload: boolean | undefined,
  ctx: ToolCallContext,
): Promise<EmbeddingIndexResult> {
  const ensured = await mlClient.ensureModel(modelId, {
    confirmDownload,
    onProgress: (fraction) => store.getState().setModelState(modelId, { progress: fraction }),
  });
  if (!ensured.ok) {
    if (ensured.error === 'unknown_model') return { ok: false, result: { ok: false, error: 'unknown_model', hint: `no model with id "${modelId}"` } };
    return { ok: false, result: { ok: false, error: ensured.error, hint: ensured.hint } };
  }
  store.getState().setModelState(modelId, { loaded: true, cached: true, progress: 1 });
  const worker = ensured.worker;

  const cacheKey = embeddingCacheKey(source, kind);
  const cached = embeddingIndexCache.get(cacheKey);
  if (cached) return { ok: true, samples: cached, worker };

  if (source.assetId) {
    const persisted = await getPersistedEmbeddings(source.assetId, kind);
    if (persisted.length > 0) {
      embeddingIndexCache.set(cacheKey, persisted);
      return { ok: true, samples: persisted, worker };
    }
  }

  const method = kind === 'mobileclip' ? 'embed_image' : 'embed_dino';
  const samples: StoredEmbedding[] = [];
  for await (const frame of sampleBitmapsForEmbedding(source, { signal: ctx.signal })) {
    const vector = await worker.call<Float32Array>(method, { bitmap: frame.bitmap });
    frame.bitmap.close();
    samples.push({ time: frame.time, vector });
    // No cheap way to know the total candidate count up front without a second pass over the
    // whole video, so this asymptotically approaches (never reaches) 0.95 rather than reporting a
    // real percentage -- still a useful "it's moving" signal for get_job's progress field.
    ctx.progress(Math.min(0.95, samples.length / (samples.length + 20)), `Indexed ${samples.length} frame(s)`);
  }

  embeddingIndexCache.set(cacheKey, samples);
  if (source.assetId) await persistEmbeddings(source.assetId, kind, samples);
  return { ok: true, samples, worker };
}

/** The `method:'dino'` branch of `find_similar_frames`: same query-resolution shape as the default
 * hash method (a captured `frameId` decoded and embedded fresh, or the nearest already-indexed
 * sample to `time`), scored by DINOv3 patch-mean cosine similarity instead of hamming+chi2. */
async function findSimilarByDino(
  store: StudioStore,
  args: { frameId?: string; time?: string | number; minScore?: number; confirmDownload?: boolean },
  ctx: ToolCallContext,
): Promise<ToolResult> {
  const state = store.getState();
  if (!state.source || state.source.kind === 'youtube') return { ok: false, error: 'no_video_loaded' };

  const indexed = await ensureEmbeddingIndex(state.source, 'dino', 'dinov3-vits16', store, args.confirmDownload, ctx);
  if (!indexed.ok) return indexed.result;
  if (indexed.samples.length === 0) return { ok: false, error: 'no_samples', hint: 'Nothing could be sampled from this source.' };

  let queryVector: ArrayLike<number>;
  if (args.frameId !== undefined) {
    const frame = state.frames.find((f) => f.id === args.frameId);
    if (!frame) return { ok: false, error: 'unknown_frame', hint: `no frame with id "${args.frameId}"` };
    const blob = await fetch(frame.blobUrl).then((r) => r.blob());
    const bitmap = await createImageBitmap(blob);
    try {
      queryVector = await indexed.worker.call<Float32Array>('embed_dino', { bitmap });
    } finally {
      bitmap.close();
    }
  } else {
    const target = parseTime(args.time as string | number, { currentTime: state.player.currentTime, duration: state.player.duration, fps: state.player.fps });
    if (target === null) return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };
    const nearest = indexed.samples.reduce((best, s) => (Math.abs(s.time - target) < Math.abs(best.time - target) ? s : best), indexed.samples[0] as StoredEmbedding);
    queryVector = nearest.vector;
  }

  const ranges = findTopRanges(indexed.samples, queryVector, { minScore: args.minScore ?? 0.85 });
  return { ok: true, summary: `${ranges.length} matching range(s)`, ranges };
}
