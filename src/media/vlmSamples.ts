/**
 * `describe_range`'s own decode pass (Task 12): unlike `embeddingSamples.ts`'s scene-detection-
 * driven candidate timestamps, this samples exactly `count` frames evenly spaced across
 * `[from, to]` -- the plan's own "samples frames (default 6, max 12) evenly" requirement. Kept
 * separate from embeddingSamples.ts since the sampling strategy (even spacing vs. scene-detection
 * candidates) and target resolution (a VLM's own input size vs. CLIP/DINO's fixed 224x224) differ.
 */
import { CanvasSink } from 'mediabunny';
import { getInput } from './input';
import type { ResolvedSource } from './source';

/** A VLM frame's long edge, per the plan's own "captured at <=512 px long edge" Key Decision. */
export const VLM_MAX_LONG_EDGE = 512;

export interface VlmFrame {
  time: number;
  bitmap: ImageBitmap;
}

/** Evenly spaced timestamps in `[from, to]`: `count===1` samples the midpoint; `count>=2` always
 * includes both endpoints. */
export function evenlySpacedTimestamps(from: number, to: number, count: number): number[] {
  if (count <= 1) return [(from + to) / 2];
  const step = (to - from) / (count - 1);
  return Array.from({ length: count }, (_, i) => from + step * i);
}

export async function sampleFramesEvenly(source: ResolvedSource, from: number, to: number, count: number): Promise<VlmFrame[]> {
  const input = await getInput(source);
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('no_video_track: this source has no video track to analyze');

  const timestamps = evenlySpacedTimestamps(from, to, count);
  const [displayWidth, displayHeight] = await Promise.all([track.getDisplayWidth(), track.getDisplayHeight()]);
  const longEdge = Math.max(displayWidth, displayHeight);
  const scale = Math.min(1, VLM_MAX_LONG_EDGE / longEdge);
  const width = Math.round(displayWidth * scale);
  const height = Math.round(displayHeight * scale);

  const canvasSink = new CanvasSink(track, { width, height, fit: 'fill' });
  const frames: VlmFrame[] = [];
  for await (const wrapped of canvasSink.canvasesAtTimestamps(timestamps)) {
    if (!wrapped) continue;
    frames.push({ time: wrapped.timestamp, bitmap: await createImageBitmap(wrapped.canvas) });
  }
  return frames;
}
