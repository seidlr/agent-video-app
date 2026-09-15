/**
 * The impure decode pass Task 8's embedding-backed tools (`search_frames`, `find_similar_frames
 * {method:'dino'}`) share: decodes `source` at the same candidate timestamps as scene-detection/
 * dHash similarity (media/scenes.ts's own `collectSampleTimestamps`, per the plan's own "reusing
 * the scene-detection decode pass" Key Decision), but at MobileCLIP/DINOv3's own 224x224 input
 * resolution instead of dHash's tiny 64x36.
 *
 * Yields one bitmap at a time (an async generator, not an array) rather than decoding the whole
 * video into memory up front: a long video's candidate set can run into the thousands of samples,
 * and `CanvasSink`'s own `poolSize` reuses a small, fixed number of underlying canvas buffers, so
 * each yielded bitmap is copied out via `createImageBitmap` (an independent, safe-to-transfer
 * snapshot) before the sink's next iteration can recycle that pooled buffer's pixels.
 */
import { CanvasSink } from 'mediabunny';
import { collectSampleTimestamps } from './scenes';
import { getInput } from './input';
import type { ResolvedSource } from './source';

/** MobileCLIP and DINOv3 (ViT-S/16) both expect a 224x224 input, per their own preprocessor
 * configs -- one shared decode resolution for both embedding indexes. */
export const EMBED_IMAGE_SIZE = 224;

export interface EmbeddingFrame {
  time: number;
  bitmap: ImageBitmap;
}

export async function* sampleBitmapsForEmbedding(source: ResolvedSource, options: { signal?: AbortSignal } = {}): AsyncGenerator<EmbeddingFrame> {
  const input = await getInput(source);
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('no_video_track: this source has no video track to analyze');

  const duration = await input.computeDuration();
  const timestamps = await collectSampleTimestamps(track, duration, options.signal);

  // `fit:'cover'` (not scenes.ts's `'fill'`) preserves aspect ratio by cropping -- the right choice
  // for a model that reasons about real object shapes, where `'fill'`'s stretch would distort them.
  const canvasSink = new CanvasSink(track, { width: EMBED_IMAGE_SIZE, height: EMBED_IMAGE_SIZE, fit: 'cover', poolSize: 2 });
  for await (const wrapped of canvasSink.canvasesAtTimestamps(timestamps)) {
    options.signal?.throwIfAborted();
    if (!wrapped) continue;
    const bitmap = await createImageBitmap(wrapped.canvas);
    yield { time: wrapped.timestamp, bitmap };
  }
}
