import {
  AudioBufferSink,
  AudioBufferSource,
  BufferTarget,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
  WebMOutputFormat,
} from 'mediabunny';
import { isBoxVisibleAt } from '../lib/boxVisibility';
import type { Box } from '../lib/types';
import { drawOverlays } from './capture';

export interface ExportClipRange {
  start: number;
  end: number;
}

export interface ExportVideoOptions {
  clips: ExportClipRange[];
  /** Desired output width in pixels; height is derived from the source's own aspect ratio. */
  width?: number;
  format?: 'mp4' | 'webm';
  /** Draws each box visible at a frame's original (pre-concatenation) source time onto that
   * frame, same reserved annotate color as capture_frame's own includeOverlays. */
  burnOverlays?: boolean;
  boxes?: Box[];
  onProgress?: (fraction: number) => void;
}

export interface ExportVideoResult {
  blob: Blob;
  durationSeconds: number;
  width: number;
  height: number;
  codec: string;
}

/** The candidate codec lists `getFirstEncodableVideoCodec`/`getFirstEncodableAudioCodec` probe, in
 * priority order -- `avc`/`aac` first per the plan's own DoD wording ("avc + aac"), falling back
 * to formats every one of this app's target browsers can actually encode. */
const VIDEO_CODEC_CANDIDATES = ['avc', 'vp9', 'av1'] as const;
const AUDIO_CODEC_CANDIDATES = ['aac', 'opus'] as const;

/**
 * Trims and concatenates `clips` (absolute source-time ranges, already resolved by the caller)
 * into a single output file. Mediabunny's own `Conversion` (including its `composable` mode) has
 * no built-in recipe for concatenating multiple trim ranges into one continuous track --
 * `composable` conversions each contribute their own SEPARATE track to a shared `Output` (for
 * combining e.g. a copied video track with an externally-produced audio track), not for splicing
 * several time ranges of the SAME track together (confirmed against mediabunny's own official
 * guide, `docs/guide/converting-media-files.md`'s "Composable conversions" section, and its
 * source-level test suite -- no concatenation example exists anywhere in either). This instead
 * builds the output manually: `VideoSampleSink`/`AudioBufferSink` decode each clip's own range,
 * every video frame is re-timestamped onto a continuous output timeline via a fresh `VideoSample`
 * (drawn through an `OffscreenCanvas`, which also handles resizing and, when requested, overlay
 * burning in the same pass), and `AudioBufferSource` naturally concatenates whatever `AudioBuffer`s
 * it's given in call order regardless of their original timestamps -- exactly the semantics this
 * needs, with no manual audio timestamp math at all.
 */
export async function exportVideoClips(input: Input, options: ExportVideoOptions): Promise<ExportVideoResult> {
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error('no_video_track: the source has no video track to export');
  const audioTrack = await input.getPrimaryAudioTrack();

  const naturalWidth = await videoTrack.getDisplayWidth();
  const naturalHeight = await videoTrack.getDisplayHeight();
  const width = options.width ? Math.round(options.width) : naturalWidth;
  const height = Math.round(naturalHeight * (width / naturalWidth));

  const videoCodec = await getFirstEncodableVideoCodec([...VIDEO_CODEC_CANDIDATES], { width, height });
  if (!videoCodec) throw new Error('no_encodable_video_codec: this browser cannot encode any supported video codec');
  const audioCodec = audioTrack ? await getFirstEncodableAudioCodec([...AUDIO_CODEC_CANDIDATES]) : null;

  const outputFormat = options.format === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat();
  const target = new BufferTarget();
  const output = new Output({ format: outputFormat, target });

  const videoSource = new VideoSampleSource({ codec: videoCodec, quality: new Quality('high') });
  output.addVideoTrack(videoSource);

  const audioSource = audioTrack && audioCodec ? new AudioBufferSource({ codec: audioCodec, quality: new Quality('high') }) : null;
  if (audioSource) output.addAudioTrack(audioSource);

  await output.start();

  const videoSink = new VideoSampleSink(videoTrack);
  const audioSink = audioTrack ? new AudioBufferSink(audioTrack) : null;

  const totalDuration = options.clips.reduce((sum, c) => sum + (c.end - c.start), 0);
  let accumulatedTime = 0;
  let processedTime = 0;

  for (const clip of options.clips) {
    const clipDuration = clip.end - clip.start;
    const visibleBoxes = options.burnOverlays ? (options.boxes ?? []) : [];

    for await (const sample of videoSink.samples(clip.start, clip.end)) {
      const outputTimestamp = accumulatedTime + Math.max(0, sample.timestamp - clip.start);

      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas_context_unavailable');
      sample.draw(ctx, 0, 0, width, height);
      const framesBoxes = visibleBoxes.filter((b) => isBoxVisibleAt(b, sample.timestamp));
      // A much thicker stroke than capture_frame's lossless-PNG default (2px) -- see drawOverlays'
      // own doc comment for why a thin line doesn't reliably survive H.264 4:2:0 chroma subsampling.
      if (framesBoxes.length > 0) drawOverlays(ctx, framesBoxes, width, height, 12);

      const outSample = new VideoSample(canvas, { timestamp: outputTimestamp, duration: sample.duration });
      await videoSource.add(outSample);
      outSample.close();
      sample.close();

      processedTime += sample.duration;
      options.onProgress?.(Math.min(1, processedTime / Math.max(totalDuration, 1e-6)));
    }

    if (audioSink && audioSource) {
      for await (const { buffer } of audioSink.buffers(clip.start, clip.end)) {
        await audioSource.add(buffer);
      }
    }

    accumulatedTime += clipDuration;
  }

  videoSource.close();
  audioSource?.close();
  await output.finalize();

  const buffer = target.buffer;
  if (!buffer) throw new Error('export_failed: output produced no data');
  const mimeType = options.format === 'webm' ? 'video/webm' : 'video/mp4';
  return { blob: new Blob([buffer], { type: mimeType }), durationSeconds: accumulatedTime, width, height, codec: videoCodec };
}
