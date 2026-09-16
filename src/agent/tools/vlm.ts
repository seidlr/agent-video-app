import { getCatalogEntry, resolveVlmId, type VlmTier } from '../../ml/catalog';
import { mlClient } from '../../ml/client';
import { buildAskMessages, buildDescribeFrameMessages, buildDescribeRangeMessages, DEFAULT_DESCRIBE_PROMPT, joinPerFrameFallback } from '../../ml/vlmPrompts';
import type { FlorenceBox } from '../../ml/florence.worker';
import { sampleFramesEvenly } from '../../media/vlmSamples';
import type { BoxSource } from '../../lib/types';
import { parseTime, secsToTimecode } from '../../lib/time';
import { getVideoElement } from '../../lib/videoElement';
import { persistBox } from '../../store/boxes';
import type { StudioStore } from '../../store/studio';
import type { Registry, ToolResult } from '../registry';

const DEFAULT_RANGE_FRAMES = 6;
const MAX_RANGE_FRAMES = 12;

interface GenerateWorkerResult {
  text: string;
}

/** Every VLM tool shares this: resolve the tier -> catalog id, ensure it's resident (the usual
 * confirmDownload gate), and report load progress into the Models panel like every other family. */
async function ensureVlmModel(store: StudioStore, tier: VlmTier | undefined, confirmDownload: boolean | undefined) {
  const modelId = resolveVlmId(tier);
  const entry = getCatalogEntry(modelId);
  if (!entry) return { ok: false as const, error: 'unknown_model' as const, hint: `no VLM tier "${tier}"` };
  const ensured = await mlClient.ensureModel(modelId, {
    confirmDownload,
    onProgress: (fraction) => store.getState().setModelState(modelId, { progress: fraction }),
  });
  if (!ensured.ok) {
    if (ensured.error === 'unknown_model') return { ok: false as const, error: 'unknown_model' as const, hint: `no model with id "${modelId}"` };
    return { ok: false as const, error: ensured.error, hint: ensured.hint };
  }
  store.getState().setModelState(modelId, { loaded: true, cached: true, progress: 1 });
  return { ok: true as const, worker: ensured.worker, modelId };
}

/** vlm/Florence tools: describe_frame, describe_range, ask_about_frame, read_text,
 * dense_captions, ground_phrase (Task 12). All job-mode (real inference can take a while), `local`
 * (need direct pixel access -- unavailable for a YouTube source, same restriction as every other
 * pixel-touching vision tool), and `untrustedContentHint` (their text output describes video
 * content an agent didn't author, same caution `transcribe`'s own annotation already applies).
 */
export function defineVlmTools(registry: Registry, store: StudioStore): void {
  registry.define<{ time?: string | number; prompt?: string; model?: VlmTier; confirmDownload?: boolean }>({
    name: 'describe_frame',
    description: `Describes a single video frame in natural language (a local VLM: fast/default/quality tiers). Default prompt: "${DEFAULT_DESCRIBE_PROMPT}". First call without confirmDownload to see the model size.`,
    inputSchema: {
      type: 'object',
      properties: {
        time: { type: ['string', 'number'] },
        prompt: { type: 'string' },
        model: { type: 'string', enum: ['fast', 'default', 'quality'] },
        confirmDownload: { type: 'boolean' },
      },
    },
    group: 'vlm',
    when: 'local',
    mode: 'job',
    annotations: { untrustedContentHint: true },
    handler: async (args): Promise<ToolResult> => {
      const state = store.getState();
      if (!state.source) return { ok: false, error: 'no_video_loaded' };
      if (state.source.kind === 'youtube') return { ok: false, error: 'describe_frame_unavailable_on_youtube', hint: 'Needs direct pixel access; not available for a YouTube source.' };

      const video = getVideoElement();
      if (!video) return { ok: false, error: 'video_not_ready' };

      const ensured = await ensureVlmModel(store, args.model, args.confirmDownload);
      if (!ensured.ok) return ensured;

      let previousTime: number | undefined;
      if (args.time !== undefined) {
        const target = parseTime(args.time, { currentTime: state.player.currentTime, duration: state.player.duration, fps: state.player.fps });
        if (target === null) return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };
        previousTime = state.player.currentTime;
        await store.getState().seek(target);
      }

      const start = Date.now();
      const bitmap = await createImageBitmap(video);
      let result: GenerateWorkerResult;
      try {
        const messages = buildDescribeFrameMessages(args.prompt);
        result = await ensured.worker.call<GenerateWorkerResult>('generate', { messages, bitmaps: [bitmap] }, (chunk) => {
          store.getState().setVisionStreaming((store.getState().visionStreaming ?? '') + chunk);
        });
      } finally {
        bitmap.close();
        store.getState().setVisionStreaming(null);
      }

      const capturedAt = video.currentTime;
      if (previousTime !== undefined) await store.getState().seek(previousTime);

      store.getState().addVisionResult({ time: capturedAt, kind: 'describe', text: result.text, model: ensured.modelId });
      return { ok: true, summary: `Described frame at ${secsToTimecode(capturedAt)}`, text: result.text, model: ensured.modelId, ms: Date.now() - start, time: capturedAt };
    },
  });

  registry.define<{ time?: string | number; question: string; model?: VlmTier; confirmDownload?: boolean }>({
    name: 'ask_about_frame',
    description: 'Asks a free-form question about a single video frame (a local VLM: fast/default/quality tiers). First call without confirmDownload to see the model size.',
    inputSchema: {
      type: 'object',
      properties: {
        time: { type: ['string', 'number'] },
        question: { type: 'string' },
        model: { type: 'string', enum: ['fast', 'default', 'quality'] },
        confirmDownload: { type: 'boolean' },
      },
      required: ['question'],
    },
    group: 'vlm',
    when: 'local',
    mode: 'job',
    annotations: { untrustedContentHint: true },
    handler: async (args): Promise<ToolResult> => {
      const state = store.getState();
      if (!state.source) return { ok: false, error: 'no_video_loaded' };
      if (state.source.kind === 'youtube') return { ok: false, error: 'ask_about_frame_unavailable_on_youtube', hint: 'Needs direct pixel access; not available for a YouTube source.' };

      const video = getVideoElement();
      if (!video) return { ok: false, error: 'video_not_ready' };

      const ensured = await ensureVlmModel(store, args.model, args.confirmDownload);
      if (!ensured.ok) return ensured;

      let previousTime: number | undefined;
      if (args.time !== undefined) {
        const target = parseTime(args.time, { currentTime: state.player.currentTime, duration: state.player.duration, fps: state.player.fps });
        if (target === null) return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };
        previousTime = state.player.currentTime;
        await store.getState().seek(target);
      }

      const start = Date.now();
      const bitmap = await createImageBitmap(video);
      let result: GenerateWorkerResult;
      try {
        const messages = buildAskMessages(args.question);
        result = await ensured.worker.call<GenerateWorkerResult>('generate', { messages, bitmaps: [bitmap] }, (chunk) => {
          store.getState().setVisionStreaming((store.getState().visionStreaming ?? '') + chunk);
        });
      } finally {
        bitmap.close();
        store.getState().setVisionStreaming(null);
      }

      const capturedAt = video.currentTime;
      if (previousTime !== undefined) await store.getState().seek(previousTime);

      store.getState().addVisionResult({ time: capturedAt, kind: 'ask', text: result.text, model: ensured.modelId });
      return { ok: true, summary: `Answered "${args.question}" at ${secsToTimecode(capturedAt)}`, text: result.text, model: ensured.modelId, ms: Date.now() - start, time: capturedAt };
    },
  });

  registry.define<{ from: string | number; to: string | number; frames?: number; model?: VlmTier; confirmDownload?: boolean }>({
    name: 'describe_range',
    description: `Describes what happens across a time range by sampling frames evenly (default 6, max ${MAX_RANGE_FRAMES}) and sending them to a local VLM as one multi-image prompt. Falls back to per-frame descriptions joined together if the tier rejects multi-image input. First call without confirmDownload to see the model size.`,
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: ['string', 'number'] },
        to: { type: ['string', 'number'] },
        frames: { type: 'integer', minimum: 2, maximum: MAX_RANGE_FRAMES },
        model: { type: 'string', enum: ['fast', 'default', 'quality'] },
        confirmDownload: { type: 'boolean' },
      },
      required: ['from', 'to'],
    },
    group: 'vlm',
    when: 'local',
    mode: 'job',
    annotations: { untrustedContentHint: true },
    handler: async (args): Promise<ToolResult> => {
      const state = store.getState();
      if (!state.source) return { ok: false, error: 'no_video_loaded' };
      if (state.source.kind === 'youtube') return { ok: false, error: 'describe_range_unavailable_on_youtube', hint: 'Needs direct pixel access; not available for a YouTube source.' };

      const fromTarget = parseTime(args.from, { currentTime: state.player.currentTime, duration: state.player.duration, fps: state.player.fps });
      const toTarget = parseTime(args.to, { currentTime: state.player.currentTime, duration: state.player.duration, fps: state.player.fps });
      if (fromTarget === null || toTarget === null) return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };
      if (toTarget <= fromTarget) return { ok: false, error: 'invalid_range', hint: '"to" must be after "from".' };

      const ensured = await ensureVlmModel(store, args.model, args.confirmDownload);
      if (!ensured.ok) return ensured;

      const frameCount = Math.min(MAX_RANGE_FRAMES, Math.max(2, args.frames ?? DEFAULT_RANGE_FRAMES));
      const start = Date.now();
      const sampled = await sampleFramesEvenly(state.source, fromTarget, toTarget, frameCount);
      try {
        let text: string;
        let usedFallback = false;
        try {
          const messages = buildDescribeRangeMessages(sampled.length, secsToTimecode(fromTarget), secsToTimecode(toTarget));
          const result = await ensured.worker.call<GenerateWorkerResult>('generate', { messages, bitmaps: sampled.map((f) => f.bitmap), range: true }, (chunk) => {
            store.getState().setVisionStreaming((store.getState().visionStreaming ?? '') + chunk);
          });
          text = result.text;
        } catch (error) {
          // The tier rejected multi-image input -- fall back to per-frame describe_frame joined
          // together, per the plan's own Key Decision, rather than failing the whole call.
          usedFallback = true;
          const perFrame = await Promise.all(
            sampled.map(async (f) => {
              const result = await ensured.worker.call<GenerateWorkerResult>('generate', { messages: buildDescribeFrameMessages(), bitmaps: [f.bitmap] });
              return { time: f.time, text: result.text };
            }),
          );
          text = joinPerFrameFallback(perFrame);
          if (!(error instanceof Error)) throw error;
        }

        store.getState().addVisionResult({ time: fromTarget, kind: 'describe_range', text, model: ensured.modelId });
        return {
          ok: true,
          summary: `Described ${secsToTimecode(fromTarget)}-${secsToTimecode(toTarget)} (${sampled.length} frames${usedFallback ? ', per-frame fallback' : ''})`,
          text,
          model: ensured.modelId,
          ms: Date.now() - start,
          sampledTimes: sampled.map((f) => f.time),
        };
      } finally {
        for (const f of sampled) f.bitmap.close();
        store.getState().setVisionStreaming(null);
      }
    },
  });

  registry.define<{ time?: string | number; confirmDownload?: boolean }>({
    name: 'read_text',
    description: 'Reads on-screen text in a frame with Florence-2 OCR, adding a box per detected text region. First call without confirmDownload to see the model size.',
    inputSchema: {
      type: 'object',
      properties: { time: { type: ['string', 'number'] }, confirmDownload: { type: 'boolean' } },
    },
    group: 'vlm',
    when: 'local',
    mode: 'job',
    annotations: { untrustedContentHint: true },
    handler: async (args): Promise<ToolResult> => {
      const state = store.getState();
      if (!state.source) return { ok: false, error: 'no_video_loaded' };
      if (state.source.kind === 'youtube') return { ok: false, error: 'read_text_unavailable_on_youtube', hint: 'Needs direct pixel access; not available for a YouTube source.' };

      const video = getVideoElement();
      if (!video) return { ok: false, error: 'video_not_ready' };

      const ensured = await ensureFlorence(store, args.confirmDownload);
      if (!ensured.ok) return ensured;

      let previousTime: number | undefined;
      if (args.time !== undefined) {
        const target = parseTime(args.time, { currentTime: state.player.currentTime, duration: state.player.duration, fps: state.player.fps });
        if (target === null) return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };
        previousTime = state.player.currentTime;
        await store.getState().seek(target);
      }

      const bitmap = await createImageBitmap(video);
      let result: { text: string; boxes: FlorenceBox[] };
      try {
        result = await ensured.worker.call('read_text', { bitmap });
      } finally {
        bitmap.close();
      }

      const capturedAt = video.currentTime;
      if (previousTime !== undefined) await store.getState().seek(previousTime);

      const source: BoxSource = 'ocr';
      const boxIds = await Promise.all(
        result.boxes.map(async (b) => {
          const boxId = store.getState().addBox({ time: capturedAt, x: b.box.x, y: b.box.y, w: b.box.w, h: b.box.h, label: b.label, source });
          await persistBox({ id: boxId, time: capturedAt, x: b.box.x, y: b.box.y, w: b.box.w, h: b.box.h, label: b.label, source });
          return boxId;
        }),
      );

      return { ok: true, summary: `${result.boxes.length} text region(s) at ${secsToTimecode(capturedAt)}`, boxes: result.boxes, boxIds };
    },
  });

  registry.define<{ time?: string | number; confirmDownload?: boolean }>({
    name: 'dense_captions',
    description: 'Captions several regions of a frame with Florence-2, returning each region and its description (exploratory -- does not add boxes; use ground_phrase to localize one specific phrase). First call without confirmDownload to see the model size.',
    inputSchema: {
      type: 'object',
      properties: { time: { type: ['string', 'number'] }, confirmDownload: { type: 'boolean' } },
    },
    group: 'vlm',
    when: 'local',
    mode: 'job',
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    handler: async (args): Promise<ToolResult> => {
      const state = store.getState();
      if (!state.source) return { ok: false, error: 'no_video_loaded' };
      if (state.source.kind === 'youtube') return { ok: false, error: 'dense_captions_unavailable_on_youtube', hint: 'Needs direct pixel access; not available for a YouTube source.' };

      const video = getVideoElement();
      if (!video) return { ok: false, error: 'video_not_ready' };

      const ensured = await ensureFlorence(store, args.confirmDownload);
      if (!ensured.ok) return ensured;

      let previousTime: number | undefined;
      if (args.time !== undefined) {
        const target = parseTime(args.time, { currentTime: state.player.currentTime, duration: state.player.duration, fps: state.player.fps });
        if (target === null) return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };
        previousTime = state.player.currentTime;
        await store.getState().seek(target);
      }

      const bitmap = await createImageBitmap(video);
      let result: { text: string; boxes: FlorenceBox[] };
      try {
        result = await ensured.worker.call('dense_captions', { bitmap });
      } finally {
        bitmap.close();
      }

      const capturedAt = video.currentTime;
      if (previousTime !== undefined) await store.getState().seek(previousTime);

      return { ok: true, summary: `${result.boxes.length} region caption(s) at ${secsToTimecode(capturedAt)}`, boxes: result.boxes };
    },
  });

  registry.define<{ phrase: string; time?: string | number; confirmDownload?: boolean }>({
    name: 'ground_phrase',
    description: 'Localizes a phrase (e.g. "the red car") to a box in a frame with Florence-2. First call without confirmDownload to see the model size.',
    inputSchema: {
      type: 'object',
      properties: { phrase: { type: 'string' }, time: { type: ['string', 'number'] }, confirmDownload: { type: 'boolean' } },
      required: ['phrase'],
    },
    group: 'vlm',
    when: 'local',
    mode: 'job',
    annotations: { untrustedContentHint: true },
    handler: async (args): Promise<ToolResult> => {
      const state = store.getState();
      if (!state.source) return { ok: false, error: 'no_video_loaded' };
      if (state.source.kind === 'youtube') return { ok: false, error: 'ground_phrase_unavailable_on_youtube', hint: 'Needs direct pixel access; not available for a YouTube source.' };

      const video = getVideoElement();
      if (!video) return { ok: false, error: 'video_not_ready' };

      const ensured = await ensureFlorence(store, args.confirmDownload);
      if (!ensured.ok) return ensured;

      let previousTime: number | undefined;
      if (args.time !== undefined) {
        const target = parseTime(args.time, { currentTime: state.player.currentTime, duration: state.player.duration, fps: state.player.fps });
        if (target === null) return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };
        previousTime = state.player.currentTime;
        await store.getState().seek(target);
      }

      const bitmap = await createImageBitmap(video);
      let result: { text: string; boxes: FlorenceBox[] };
      try {
        result = await ensured.worker.call('ground_phrase', { bitmap, phrase: args.phrase });
      } finally {
        bitmap.close();
      }

      const capturedAt = video.currentTime;
      if (previousTime !== undefined) await store.getState().seek(previousTime);

      const firstBox = result.boxes[0];
      if (!firstBox) return { ok: true, summary: `"${args.phrase}" not found at ${secsToTimecode(capturedAt)}`, boxes: [] };

      const source: BoxSource = 'ground';
      const boxId = store.getState().addBox({ time: capturedAt, x: firstBox.box.x, y: firstBox.box.y, w: firstBox.box.w, h: firstBox.box.h, label: args.phrase, source });
      await persistBox({ id: boxId, time: capturedAt, x: firstBox.box.x, y: firstBox.box.y, w: firstBox.box.w, h: firstBox.box.h, label: args.phrase, source });

      return { ok: true, summary: `Grounded "${args.phrase}" at ${secsToTimecode(capturedAt)}`, boxId, box: firstBox.box };
    },
  });
}

async function ensureFlorence(store: StudioStore, confirmDownload: boolean | undefined) {
  const modelId = 'florence2-base';
  const entry = getCatalogEntry(modelId);
  if (!entry) return { ok: false as const, error: 'unknown_model' as const, hint: `no model with id "${modelId}"` };
  const ensured = await mlClient.ensureModel(modelId, {
    confirmDownload,
    onProgress: (fraction) => store.getState().setModelState(modelId, { progress: fraction }),
  });
  if (!ensured.ok) {
    if (ensured.error === 'unknown_model') return { ok: false as const, error: 'unknown_model' as const, hint: `no model with id "${modelId}"` };
    return { ok: false as const, error: ensured.error, hint: ensured.hint };
  }
  store.getState().setModelState(modelId, { loaded: true, cached: true, progress: 1 });
  return { ok: true as const, worker: ensured.worker, modelId };
}
