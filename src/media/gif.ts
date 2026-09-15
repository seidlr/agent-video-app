import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { CanvasSink } from 'mediabunny';
import type { Input } from 'mediabunny';

export interface ExportGifOptions {
  start: number;
  end: number;
  width?: number;
  fps?: number;
  onProgress?: (fraction: number) => void;
}

export interface ExportGifResult {
  blob: Blob;
  frames: number;
  width: number;
  height: number;
}

/** GIF frame cap per the plan's own Key Decisions -- above this, `export_gif` should fail fast
 * with a clear `too_many_frames` error rather than silently building a huge in-memory buffer of
 * raw RGBA frame data (this module decodes every frame up front to compute one global palette
 * before encoding any of them, so memory scales linearly with frame count). */
export const MAX_GIF_FRAMES = 300;

/**
 * Samples `[start, end)` at `fps`, builds one global 256-color palette from every 5th sampled
 * frame (per the plan's own wording), then encodes every frame against that shared palette --
 * gifenc has no built-in "video to GIF" helper, just the three primitives (`quantize`/
 * `applyPalette`/`GIFEncoder`) this wires up directly. Two passes over the decoded frame data
 * (collect, then encode) rather than one, so the palette reflects the whole clip instead of
 * whatever frame happened to be quantized first; bounded by `MAX_GIF_FRAMES` so this stays a
 * one-time, capped memory cost.
 */
export async function exportGif(input: Input, options: ExportGifOptions): Promise<ExportGifResult> {
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error('no_video_track: the source has no video track to export');

  const fps = options.fps ?? 10;
  const duration = options.end - options.start;
  const frameCount = Math.max(1, Math.round(duration * fps));
  if (frameCount > MAX_GIF_FRAMES) {
    throw new Error(`too_many_frames: ${frameCount} frames requested (${duration}s at ${fps}fps), max is ${MAX_GIF_FRAMES}`);
  }

  const naturalWidth = await videoTrack.getDisplayWidth();
  const naturalHeight = await videoTrack.getDisplayHeight();
  const width = options.width ? Math.round(options.width) : 320;
  const height = Math.round(naturalHeight * (width / naturalWidth));

  const timestamps: number[] = [];
  for (let i = 0; i < frameCount; i++) timestamps.push(options.start + i / fps);

  const sink = new CanvasSink(videoTrack, { width, height, fit: 'contain' });
  const frameDatas: Uint8ClampedArray[] = [];
  for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
    if (!wrapped) continue; // no sample at/after this timestamp (e.g. requested past the track's end)
    const ctx = wrapped.canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('canvas_context_unavailable');
    frameDatas.push(ctx.getImageData(0, 0, width, height).data);
    options.onProgress?.((frameDatas.length / frameCount) * 0.5);
  }

  // Global palette from every 5th frame's pixels, concatenated.
  const sampleFrames = frameDatas.filter((_, i) => i % 5 === 0);
  const totalSampleLength = sampleFrames.reduce((sum, d) => sum + d.length, 0);
  const combined = new Uint8ClampedArray(totalSampleLength);
  let offset = 0;
  for (const d of sampleFrames) {
    combined.set(d, offset);
    offset += d.length;
  }
  const palette = quantize(combined, 256, { format: 'rgb565' });

  const gif = GIFEncoder();
  frameDatas.forEach((data, i) => {
    const index = applyPalette(data, palette, 'rgb565');
    gif.writeFrame(index, width, height, { palette: i === 0 ? palette : undefined, delay: Math.round(1000 / fps) });
    options.onProgress?.(0.5 + ((i + 1) / frameDatas.length) * 0.5);
  });
  gif.finish();

  return { blob: new Blob([new Uint8Array(gif.bytes())], { type: 'image/gif' }), frames: frameDatas.length, width, height };
}
