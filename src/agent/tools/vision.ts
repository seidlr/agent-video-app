import { getMlQueryOverrides, mlClient } from '../../ml/client';
import { pickSegmentModel } from '../../ml/catalog';
import { dilatePixelBox, getTracker, toGrayscale, trackFrames, type GrayFrame, type PixelBox } from '../../ml/tracker';
import type { BoxSource } from '../../lib/types';
import { parseTime, secsToTimecode } from '../../lib/time';
import { getVideoElement } from '../../lib/videoElement';
import { persistBox, persistTrack } from '../../store/boxes';
import type { StudioStore } from '../../store/studio';
import type { Registry, ToolResult } from '../registry';

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
}
