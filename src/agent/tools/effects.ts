import { VideoSampleSink } from 'mediabunny';
import { mlClient } from '../../ml/client';
import { matteFramePath } from '../../media/composite';
import { getInput } from '../../media/input';
import { parseTime, secsToTimecode } from '../../lib/time';
import { getVideoElement } from '../../lib/videoElement';
import type { MatteReplace, RgbColor } from '../../lib/types';
import { writeFile } from '../../store/opfs';
import type { StudioStore } from '../../store/studio';
import type { Registry, ToolResult } from '../registry';

/** Cross-frame alpha smoothing weight (Task 13 Key Decisions: "an EMA (α = 0.6)") -- how much of
 * each new frame's own raw alpha carries through versus the running average, to suppress
 * per-frame matte flicker on a static or slowly-moving subject. */
const MATTE_EMA_ALPHA = 0.6;

/** `#rgb` or `#rrggbb` (a leading `#` is optional either way) -- simple enough for an agent or a
 * human to type without a color picker. */
function parseHexColor(hex: string): RgbColor | null {
  const cleaned = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    const [r, g, b] = cleaned.split('').map((c) => parseInt(c + c, 16));
    return { r: r ?? 0, g: g ?? 0, b: b ?? 0 };
  }
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return { r: parseInt(cleaned.slice(0, 2), 16), g: parseInt(cleaned.slice(2, 4), 16), b: parseInt(cleaned.slice(4, 6), 16) };
  }
  return null;
}

/** Uses `ctx.createImageData` (always a concrete `ArrayBuffer`-backed `.data`) rather than
 * `new ImageData(rgba, ...)` -- constructing `ImageData` directly from an already-built
 * `Uint8ClampedArray` hits a real cross-tsconfig type mismatch here (this file compiles under
 * tsconfig.app.json's DOM lib, which types a plain `new Uint8ClampedArray(n)` as
 * `ArrayBufferLike`-backed, not the `ArrayBuffer`-only type `ImageData`'s constructor wants --
 * the worker-side tsconfig's WebWorker lib doesn't have this mismatch, which is why
 * segment.worker.ts/depth.worker.ts's identical-looking code doesn't need this). */
function rgbaToPngBlob(rgba: Uint8ClampedArray, width: number, height: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(rgba);
  ctx.putImageData(imageData, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

/** Encodes a per-pixel alpha map [0,1] as a plain white RGBA PNG carrying that alpha in its own
 * alpha channel -- a normal PNG viewer/reader recovers it as `data[i*4+3]`, matching the plan's
 * own "mattes stored as PNG alpha in OPFS" Key Decision. */
function alphaToPngBlob(alpha: Float32Array, width: number, height: number): Promise<Blob> {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    rgba[p * 4] = 255;
    rgba[p * 4 + 1] = 255;
    rgba[p * 4 + 2] = 255;
    rgba[p * 4 + 3] = Math.round((alpha[p] ?? 0) * 255);
  }
  return rgbaToPngBlob(rgba, width, height);
}

type MatteTier = 'portrait' | 'general';

function resolveMatteId(tier: MatteTier | undefined): string {
  return `matte-${tier ?? 'general'}`;
}

interface MattingWorkerResult {
  rgba: Uint8ClampedArray;
  alpha: Float32Array;
  width: number;
  height: number;
}

type RemoveBackgroundArgs = {
  start: string | number;
  end: string | number;
  model?: MatteTier;
  replace?: MatteReplace;
  color?: string;
  confirmDownload?: boolean;
} & Record<string, unknown>;

type GenerateVoiceoverArgs = {
  text: string;
  at: string | number;
  voice?: string;
  speed?: number;
  duck?: boolean;
  confirmDownload?: boolean;
} & Record<string, unknown>;

type UpscaleFrameArgs = {
  frameId?: string;
  time?: string | number;
  factor?: 2 | 4;
  confirmDownload?: boolean;
} & Record<string, unknown>;

const UPSCALE_TILE_SIZE = 256;
const UPSCALE_TILE_OVERLAP = 16;
const UPSCALE_MODEL_FACTOR = 4;

/** Core logic behind `remove_background` -- see runUpscaleFrame's own doc comment for why this is
 * a standalone, reusable function rather than a registry-only closure. `ctx` here is just the
 * `progress` callback; a UI caller can pass a no-op if it doesn't need a progress bar. */
export async function runRemoveBackground(store: StudioStore, args: RemoveBackgroundArgs, ctx: { progress: (fraction: number) => void }): Promise<ToolResult> {
  const state = store.getState();
  if (!state.source) return { ok: false, error: 'no_video_loaded' };
  if (state.source.kind === 'youtube') return { ok: false, error: 'remove_background_unavailable_on_youtube', hint: 'Needs direct pixel access; not available for a YouTube source.' };

  const timeCtx = { currentTime: state.player.currentTime, duration: state.player.duration, fps: state.player.fps };
  const start = parseTime(args.start, timeCtx);
  const end = parseTime(args.end, timeCtx);
  if (start === null || end === null) return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };
  if (end <= start) return { ok: false, error: 'invalid_range', hint: '`end` must be after `start`.' };

  const replace = args.replace ?? 'transparent';
  let color: RgbColor | undefined;
  if (replace === 'color') {
    color = parseHexColor(args.color ?? '#000000') ?? undefined;
    if (!color) return { ok: false, error: 'invalid_color', hint: 'Use a hex color like "#00ff00".' };
  }

  const modelId = resolveMatteId(args.model);
  const ensured = await mlClient.ensureModel(modelId, {
    confirmDownload: args.confirmDownload,
    onProgress: (fraction) => store.getState().setModelState(modelId, { progress: fraction }),
  });
  if (!ensured.ok) {
    if (ensured.error === 'unknown_model') return { ok: false, error: 'unknown_model', hint: `no model with id "${modelId}"` };
    return { ok: false, error: ensured.error, hint: ensured.hint };
  }
  store.getState().setModelState(modelId, { loaded: true, cached: true, progress: 1 });

  const effectId = store.getState().addEffect({ kind: 'matte', start, end, model: modelId, replace, color });

  const input = await getInput(state.source);
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) return { ok: false, error: 'no_video_track', hint: 'This source has no video track.' };
  const videoSink = new VideoSampleSink(videoTrack);

  let previousAlpha: Float32Array | null = null;
  let frameIndex = 0;
  const totalDuration = end - start;
  for await (const sample of videoSink.samples(start, end)) {
    const canvas = new OffscreenCanvas(sample.displayWidth, sample.displayHeight);
    const drawCtx = canvas.getContext('2d');
    if (!drawCtx) throw new Error('canvas_unavailable');
    sample.draw(drawCtx, 0, 0, sample.displayWidth, sample.displayHeight);
    const bitmap = await createImageBitmap(canvas);

    let result: MattingWorkerResult;
    try {
      result = await ensured.worker.call<MattingWorkerResult>('remove_background', { bitmap });
    } finally {
      bitmap.close();
    }

    let smoothed = result.alpha;
    if (previousAlpha) {
      smoothed = new Float32Array(result.alpha.length);
      for (let p = 0; p < smoothed.length; p++) {
        smoothed[p] = MATTE_EMA_ALPHA * (result.alpha[p] ?? 0) + (1 - MATTE_EMA_ALPHA) * (previousAlpha[p] ?? 0);
      }
    }
    previousAlpha = smoothed;

    const pngBlob = await alphaToPngBlob(smoothed, result.width, result.height);
    await writeFile(matteFramePath(effectId, sample.timestamp), pngBlob);

    frameIndex++;
    ctx.progress(Math.min(0.95, (sample.timestamp - start) / Math.max(totalDuration, 1e-6)));
    sample.close();
  }

  return {
    ok: true,
    summary: `Removed background ${secsToTimecode(start)}-${secsToTimecode(end)} (${frameIndex} frame(s), replace:${replace})`,
    effectId,
    frames: frameIndex,
  };
}

/** Core logic behind `generate_voiceover` -- see runUpscaleFrame's own doc comment. */
export async function runGenerateVoiceover(store: StudioStore, args: GenerateVoiceoverArgs): Promise<ToolResult> {
  const state = store.getState();
  if (!state.source) return { ok: false, error: 'no_video_loaded' };
  if (!args.text.trim()) return { ok: false, error: 'invalid_text', hint: '`text` must not be empty.' };

  const timeCtx = { currentTime: state.player.currentTime, duration: state.player.duration, fps: state.player.fps };
  const at = parseTime(args.at, timeCtx);
  if (at === null) return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };

  const modelId = 'kokoro-tts';
  const ensured = await mlClient.ensureModel(modelId, {
    confirmDownload: args.confirmDownload,
    onProgress: (fraction) => store.getState().setModelState(modelId, { progress: fraction }),
  });
  if (!ensured.ok) {
    if (ensured.error === 'unknown_model') return { ok: false, error: 'unknown_model', hint: `no model with id "${modelId}"` };
    return { ok: false, error: ensured.error, hint: ensured.hint };
  }
  store.getState().setModelState(modelId, { loaded: true, cached: true, progress: 1 });

  const result = await ensured.worker.call<{ wav: ArrayBuffer; durationSeconds: number }>('generate', {
    text: args.text,
    voice: args.voice,
    speed: args.speed,
  });

  const blob = new Blob([result.wav], { type: 'audio/wav' });
  const voiceoverId = store.getState().addVoiceover({
    at,
    durationSeconds: result.durationSeconds,
    text: args.text,
    voice: args.voice ?? 'af_heart',
    blob,
  });

  return {
    ok: true,
    summary: `Generated a ${result.durationSeconds.toFixed(1)}s voice-over at ${secsToTimecode(at)}`,
    voiceoverId,
    durationSeconds: result.durationSeconds,
  };
}

/** Core logic behind `upscale_frame`, extracted so a human-driven UI action (an "Upscale" button
 * per captured frame) can call the exact same pipeline the tool uses without going through the
 * registry -- the Activity feed and its Toast are reserved for what an *agent* did (see
 * Clips.tsx/Frames.tsx's own comments on this same convention), not a running log of human
 * clicks. */
export async function runUpscaleFrame(store: StudioStore, args: UpscaleFrameArgs): Promise<ToolResult> {
  const state = store.getState();
  const factor = args.factor ?? 4;

  let sourceBitmap: ImageBitmap;
  let sourceFrameId: string | undefined;
  let capturedAt: number;
  if (args.frameId !== undefined) {
    const frame = state.frames.find((f) => f.id === args.frameId);
    if (!frame) return { ok: false, error: 'unknown_frame', hint: `no frame with id "${args.frameId}"` };
    const blob = await fetch(frame.blobUrl).then((r) => r.blob());
    sourceBitmap = await createImageBitmap(blob);
    sourceFrameId = frame.id;
    capturedAt = frame.time;
  } else {
    if (!state.source) return { ok: false, error: 'no_video_loaded' };
    if (state.source.kind === 'youtube') return { ok: false, error: 'upscale_frame_unavailable_on_youtube', hint: 'Needs direct pixel access; not available for a YouTube source.' };
    const video = getVideoElement();
    if (!video) return { ok: false, error: 'video_not_ready' };
    if (args.time !== undefined) {
      const timeCtx = { currentTime: state.player.currentTime, duration: state.player.duration, fps: state.player.fps };
      const target = parseTime(args.time, timeCtx);
      if (target === null) return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };
      await store.getState().seek(target);
    }
    sourceBitmap = await createImageBitmap(video);
    capturedAt = video.currentTime;
  }

  const modelId = 'swin2sr-upscale';
  const ensured = await mlClient.ensureModel(modelId, {
    confirmDownload: args.confirmDownload,
    onProgress: (fraction) => store.getState().setModelState(modelId, { progress: fraction }),
  });
  if (!ensured.ok) {
    sourceBitmap.close();
    if (ensured.error === 'unknown_model') return { ok: false, error: 'unknown_model', hint: `no model with id "${modelId}"` };
    return { ok: false, error: ensured.error, hint: ensured.hint };
  }
  store.getState().setModelState(modelId, { loaded: true, cached: true, progress: 1 });

  const { width: srcWidth, height: srcHeight } = sourceBitmap;
  const outWidth = srcWidth * UPSCALE_MODEL_FACTOR;
  const outHeight = srcHeight * UPSCALE_MODEL_FACTOR;
  const outputCanvas = new OffscreenCanvas(outWidth, outHeight);
  const outputCtx = outputCanvas.getContext('2d');
  if (!outputCtx) throw new Error('canvas_unavailable');

  const stride = UPSCALE_TILE_SIZE - UPSCALE_TILE_OVERLAP;
  // SHORTCUT: tiles are drawn in raster order with plain source-over compositing, so a later
  // (bottom/right) tile's own overlap band cleanly overwrites an earlier tile's -- a real,
  // working seam, not a feathered cross-fade blend. Upgrade trigger: a visible seam artifact
  // becomes a real product complaint; fix by accumulating a weighted average over the overlap
  // band instead of a flat overwrite.
  for (let ty = 0; ty < srcHeight; ty += stride) {
    for (let tx = 0; tx < srcWidth; tx += stride) {
      const tileWidth = Math.min(UPSCALE_TILE_SIZE, srcWidth - tx);
      const tileHeight = Math.min(UPSCALE_TILE_SIZE, srcHeight - ty);

      const tileCanvas = new OffscreenCanvas(tileWidth, tileHeight);
      const tileCtx = tileCanvas.getContext('2d');
      if (!tileCtx) throw new Error('canvas_unavailable');
      tileCtx.drawImage(sourceBitmap, tx, ty, tileWidth, tileHeight, 0, 0, tileWidth, tileHeight);
      const tileBitmap = await createImageBitmap(tileCanvas);

      let tileResult: { rgb: Uint8Array; width: number; height: number };
      try {
        tileResult = await ensured.worker.call<{ rgb: Uint8Array; width: number; height: number }>('upscale', { bitmap: tileBitmap });
      } finally {
        tileBitmap.close();
      }

      const tileImageData = new ImageData(tileResult.width, tileResult.height);
      for (let p = 0; p < tileResult.width * tileResult.height; p++) {
        tileImageData.data[p * 4] = tileResult.rgb[p * 3] ?? 0;
        tileImageData.data[p * 4 + 1] = tileResult.rgb[p * 3 + 1] ?? 0;
        tileImageData.data[p * 4 + 2] = tileResult.rgb[p * 3 + 2] ?? 0;
        tileImageData.data[p * 4 + 3] = 255;
      }
      const upscaledTileCanvas = new OffscreenCanvas(tileResult.width, tileResult.height);
      const upscaledTileCtx = upscaledTileCanvas.getContext('2d');
      if (!upscaledTileCtx) throw new Error('canvas_unavailable');
      upscaledTileCtx.putImageData(tileImageData, 0, 0);

      outputCtx.drawImage(upscaledTileCanvas, tx * UPSCALE_MODEL_FACTOR, ty * UPSCALE_MODEL_FACTOR);
    }
  }
  sourceBitmap.close();

  let finalCanvas: OffscreenCanvas = outputCanvas;
  let finalWidth = outWidth;
  let finalHeight = outHeight;
  if (factor === 2) {
    finalWidth = srcWidth * 2;
    finalHeight = srcHeight * 2;
    finalCanvas = new OffscreenCanvas(finalWidth, finalHeight);
    const finalCtx = finalCanvas.getContext('2d');
    if (!finalCtx) throw new Error('canvas_unavailable');
    finalCtx.drawImage(outputCanvas, 0, 0, finalWidth, finalHeight);
  }

  const pngBlob = await finalCanvas.convertToBlob({ type: 'image/png' });
  const blobUrl = URL.createObjectURL(pngBlob);
  const frameId = store.getState().addFrame({ time: capturedAt, kind: 'upscaled', width: finalWidth, height: finalHeight, sourceFrameId, blobUrl });
  const { persistFrame } = await import('../../store/frames');
  const { tryPersist } = await import('../../store/persist');
  await tryPersist(store.getState(), () =>
    persistFrame({ id: frameId, time: capturedAt, kind: 'upscaled', width: finalWidth, height: finalHeight, sourceFrameId, blob: pngBlob }),
  );

  return { ok: true, summary: `Upscaled to ${finalWidth}x${finalHeight}`, frameId, width: finalWidth, height: finalHeight };
}

/**
 * Task 13 effects tools: `remove_background` (background matting with temporal alpha smoothing),
 * `generate_voiceover` (Kokoro TTS placed on the timeline), `upscale_frame` (tiled swin2SR
 * super-resolution). All `local` (need direct pixel/byte access, unavailable for a YouTube
 * source) and job-mode (real inference).
 */
export function defineEffectsTools(registry: Registry, store: StudioStore): void {
  registry.define<RemoveBackgroundArgs>({
    name: 'remove_background',
    description:
      'Removes the background from a time range using a local matting model (portrait or general tiers), replacing it with transparency, a solid color, or a blurred copy of the frame. First call without confirmDownload to see the model size.',
    inputSchema: {
      type: 'object',
      properties: {
        start: { type: ['string', 'number'] },
        end: { type: ['string', 'number'] },
        model: { type: 'string', enum: ['portrait', 'general'] },
        replace: { type: 'string', enum: ['transparent', 'color', 'blur'] },
        color: { type: 'string', description: 'Hex color (e.g. "#00ff00"), used when replace="color".' },
        confirmDownload: { type: 'boolean' },
      },
      required: ['start', 'end'],
    },
    group: 'effects',
    when: 'local',
    mode: 'job',
    annotations: { untrustedContentHint: true },
    handler: (args, ctx) => runRemoveBackground(store, args, ctx),
  });

  registry.define<GenerateVoiceoverArgs>({
    name: 'generate_voiceover',
    description: 'Generates a spoken voice-over clip from text with Kokoro TTS and places it on the timeline at the given time. First call without confirmDownload to see the model size.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        at: { type: ['string', 'number'] },
        voice: { type: 'string', description: 'A Kokoro voice id, e.g. "af_heart" (default).' },
        speed: { type: 'number' },
        duck: { type: 'boolean', description: 'Duck the original audio under this VO in exports (default true).' },
        confirmDownload: { type: 'boolean' },
      },
      required: ['text', 'at'],
    },
    group: 'effects',
    when: 'local',
    mode: 'job',
    handler: (args) => runGenerateVoiceover(store, args),
  });

  registry.define<UpscaleFrameArgs>({
    name: 'upscale_frame',
    description: 'Upscales a captured frame (or the live frame at a time) with swin2SR super-resolution (a fixed 4x model; factor:2 downsamples that result) and adds it to the Frames tray. First call without confirmDownload to see the model size.',
    inputSchema: {
      type: 'object',
      properties: {
        frameId: { type: 'string' },
        time: { type: ['string', 'number'] },
        factor: { type: 'integer', enum: [2, 4] },
        confirmDownload: { type: 'boolean' },
      },
    },
    group: 'effects',
    when: 'local',
    mode: 'job',
    handler: (args) => runUpscaleFrame(store, args),
  });
}
