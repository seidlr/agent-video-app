import {
  AudioBufferSink,
  AudioBufferSource,
  BufferTarget,
  canEncodeVideo,
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
import type { VideoCodec } from 'mediabunny';
import { isBoxVisibleAt } from '../lib/boxVisibility';
import type { Box, Effect, Voiceover } from '../lib/types';
import { decodeVoiceoverPcm } from './audio';
import { mixVoiceoverIntoChannel, resampleLinear } from './audioMix';
import { drawOverlays } from './capture';
import { applyMatte, matteFramePath } from './composite';
import { readFile } from '../store/opfs';

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
  /** Task 13: `remove_background` effects to composite in, reading each frame's own cached alpha
   * matte (agent/tools/effects.ts's OPFS cache) keyed by its exact decode timestamp. A frame whose
   * effect has no cached matte at that exact timestamp (a cache miss) is left unmodified rather
   * than re-running inference at export time. */
  effects?: Effect[];
  /** Task 13: voice-overs to mix into the exported audio, ducking the original track under each
   * one. A voice-over is mixed into whichever clip's own [start,end) it falls in; one that runs
   * past that clip's own end has its tail clipped rather than spilling into the next clip. */
  voiceovers?: Voiceover[];
  onProgress?: (fraction: number) => void;
}

export interface ExportVideoResult {
  blob: Blob;
  durationSeconds: number;
  width: number;
  height: number;
  codec: string;
  /** True when a `replace:'transparent'` effect forced WebM/VP9-with-alpha regardless of the
   * caller's own requested `format` (Task 13 Key Decision) -- the caller should say so. */
  forcedAlphaFormat: boolean;
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
/** Finds the effect (if any) covering `timestamp` and, if its own cached matte for this exact
 * frame exists (agent/tools/effects.ts's OPFS cache, keyed by `matteFramePath`), composites it
 * into `ctx`'s current contents in place. A cache miss (no matte written for this exact
 * millisecond-rounded timestamp) leaves the frame untouched rather than re-running inference. */
async function applyEffectsToFrame(ctx: OffscreenCanvasRenderingContext2D, width: number, height: number, timestamp: number, effects: Effect[]): Promise<void> {
  const effect = effects.find((e) => timestamp >= e.start && timestamp < e.end);
  if (!effect) return;

  let matteFile: File;
  try {
    matteFile = await readFile(matteFramePath(effect.id, timestamp));
  } catch {
    return; // Cache miss -- see this function's own doc comment.
  }

  const matteBitmap = await createImageBitmap(matteFile);
  // Capture width/height before close() -- Chrome zeros out an ImageBitmap's own width/height
  // once closed, so reading them afterward (as this did originally) silently turns every
  // getImageData call below into a zero-size read and throws "The source width is 0."
  const matteWidth = matteBitmap.width;
  const matteHeight = matteBitmap.height;
  const matteCanvas = new OffscreenCanvas(matteWidth, matteHeight);
  const matteCtx = matteCanvas.getContext('2d');
  if (!matteCtx) throw new Error('canvas_context_unavailable');
  matteCtx.drawImage(matteBitmap, 0, 0);
  matteBitmap.close();
  const matteRgba = matteCtx.getImageData(0, 0, matteWidth, matteHeight).data;
  const alpha = new Float32Array(matteWidth * matteHeight);
  for (let p = 0; p < alpha.length; p++) alpha[p] = (matteRgba[p * 4 + 3] ?? 0) / 255;

  const frameRgba = ctx.getImageData(0, 0, width, height).data as unknown as Uint8ClampedArray;
  let blurredRgba: Uint8ClampedArray | undefined;
  if (effect.replace === 'blur') {
    const blurCanvas = new OffscreenCanvas(width, height);
    const blurCtx = blurCanvas.getContext('2d');
    if (!blurCtx) throw new Error('canvas_context_unavailable');
    blurCtx.filter = 'blur(24px)';
    blurCtx.drawImage(ctx.canvas as OffscreenCanvas, 0, 0);
    blurredRgba = blurCtx.getImageData(0, 0, width, height).data as unknown as Uint8ClampedArray;
  }

  const composited = applyMatte(frameRgba, alpha, width, height, { replace: effect.replace, color: effect.color, blurredRgba });
  const outImageData = ctx.createImageData(width, height);
  outImageData.data.set(composited);
  ctx.putImageData(outImageData, 0, 0);
}

/** Decodes a clip's own audio range into one combined multi-channel buffer (concatenating
 * whatever `AudioBuffer` chunks the sink yields, in order, zero-filling any gap between a chunk's
 * own end and the next one's start), mixes every voice-over that falls within [clipStart,clipEnd)
 * into it (media/audioMix.ts), and returns a single `AudioBuffer` ready for `audioSource.add()`. */
async function collectAndMixClipAudio(
  audioSink: AudioBufferSink,
  clipStart: number,
  clipEnd: number,
  voiceovers: Voiceover[],
): Promise<AudioBuffer | null> {
  const chunks: { buffer: AudioBuffer; timestamp: number }[] = [];
  for await (const wrapped of audioSink.buffers(clipStart, clipEnd)) chunks.push(wrapped);
  if (chunks.length === 0) return null;

  const sampleRate = chunks[0]!.buffer.sampleRate;
  const numberOfChannels = chunks[0]!.buffer.numberOfChannels;
  const totalLength = Math.round((clipEnd - clipStart) * sampleRate);
  const channels: Float32Array[] = Array.from({ length: numberOfChannels }, () => new Float32Array(totalLength));

  for (const { buffer, timestamp } of chunks) {
    const offset = Math.round((timestamp - clipStart) * sampleRate);
    for (let c = 0; c < numberOfChannels; c++) {
      const source = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
      channels[c]!.set(source.subarray(0, Math.max(0, Math.min(source.length, totalLength - offset))), Math.max(0, offset));
    }
  }

  for (const vo of voiceovers) {
    if (vo.at < clipStart || vo.at >= clipEnd) continue;
    const decoded = await decodeVoiceoverPcm(vo.blob);
    const resampled = decoded.sampleRate === sampleRate ? decoded.samples : resampleLinear(decoded.samples, decoded.sampleRate, sampleRate);
    for (let c = 0; c < numberOfChannels; c++) {
      const mixed = mixVoiceoverIntoChannel(channels[c]!, sampleRate, resampled, vo.at - clipStart);
      // A VO running past this clip's own end is clipped to it (this function's own doc comment) --
      // never grows the clip's own output length, unlike mixVoiceoverIntoChannel's general case.
      channels[c] = mixed.length > totalLength ? mixed.slice(0, totalLength) : mixed;
    }
  }

  const outBuffer = new AudioBuffer({ length: totalLength, numberOfChannels, sampleRate });
  // `Float32Array<ArrayBufferLike>` vs `copyToChannel`'s own `Float32Array<ArrayBuffer>` param is
  // the same cross-tsconfig typed-array generic mismatch documented in agent/tools/effects.ts's
  // `rgbaToPngBlob` -- every array here is always ArrayBuffer-backed at runtime (never a
  // SharedArrayBuffer view), so this cast is safe.
  for (let c = 0; c < numberOfChannels; c++) outBuffer.copyToChannel(channels[c] as Float32Array<ArrayBuffer>, c);
  return outBuffer;
}

export async function exportVideoClips(input: Input, options: ExportVideoOptions): Promise<ExportVideoResult> {
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error('no_video_track: the source has no video track to export');
  const audioTrack = await input.getPrimaryAudioTrack();

  const naturalWidth = await videoTrack.getDisplayWidth();
  const naturalHeight = await videoTrack.getDisplayHeight();
  const width = options.width ? Math.round(options.width) : naturalWidth;
  const height = Math.round(naturalHeight * (width / naturalWidth));

  const effects = options.effects ?? [];
  const voiceovers = options.voiceovers ?? [];
  // Task 13 Key Decision: a transparent-background effect forces WebM/VP9 with alpha regardless
  // of the caller's own requested format -- avc/mp4 has no browser-encodable alpha path here.
  const needsAlpha = effects.some((e) => e.replace === 'transparent');
  const forcedAlphaFormat = needsAlpha && options.format !== 'webm';

  let videoCodec: VideoCodec | null;
  if (needsAlpha) {
    const vp9Ok = await canEncodeVideo('vp9', { width, height, alpha: 'keep' });
    if (!vp9Ok) throw new Error('no_encodable_video_codec: this browser cannot encode VP9 with alpha for a transparent-background export');
    videoCodec = 'vp9';
  } else {
    videoCodec = await getFirstEncodableVideoCodec([...VIDEO_CODEC_CANDIDATES], { width, height });
  }
  if (!videoCodec) throw new Error('no_encodable_video_codec: this browser cannot encode any supported video codec');
  const audioCodec = audioTrack ? await getFirstEncodableAudioCodec([...AUDIO_CODEC_CANDIDATES]) : null;

  const outputFormat = needsAlpha || options.format === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat();
  const target = new BufferTarget();
  const output = new Output({ format: outputFormat, target });

  const videoSource = new VideoSampleSource({ codec: videoCodec, quality: new Quality('high'), ...(needsAlpha ? { alpha: 'keep' as const } : {}) });
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
      if (effects.length > 0) await applyEffectsToFrame(ctx, width, height, sample.timestamp, effects);

      const outSample = new VideoSample(canvas, { timestamp: outputTimestamp, duration: sample.duration });
      await videoSource.add(outSample);
      outSample.close();
      sample.close();

      processedTime += sample.duration;
      options.onProgress?.(Math.min(1, processedTime / Math.max(totalDuration, 1e-6)));
    }

    if (audioSink && audioSource) {
      const clipVoiceovers = voiceovers.filter((v) => v.at >= clip.start && v.at < clip.end);
      if (clipVoiceovers.length > 0) {
        const mixed = await collectAndMixClipAudio(audioSink, clip.start, clip.end, clipVoiceovers);
        if (mixed) await audioSource.add(mixed);
      } else {
        for await (const { buffer } of audioSink.buffers(clip.start, clip.end)) {
          await audioSource.add(buffer);
        }
      }
    }

    accumulatedTime += clipDuration;
  }

  videoSource.close();
  audioSource?.close();
  await output.finalize();

  const buffer = target.buffer;
  if (!buffer) throw new Error('export_failed: output produced no data');
  const mimeType = needsAlpha || options.format === 'webm' ? 'video/webm' : 'video/mp4';
  return { blob: new Blob([buffer], { type: mimeType }), durationSeconds: accumulatedTime, width, height, codec: videoCodec, forcedAlphaFormat };
}
