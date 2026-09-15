import type { Box } from '../lib/types';
import { secsToTimecode } from '../lib/time';

export type CaptureFormat = 'png' | 'jpeg' | 'webp';

export interface CaptureOptions {
  maxWidth?: number;
  format?: CaptureFormat;
  /** Boxes to draw as overlays, already filtered to the ones visible at the captured time. */
  boxes?: Box[];
}

export interface CaptureResult {
  blob: Blob;
  width: number;
  height: number;
}

export type CaptureErrorCode = 'video_not_ready' | 'source_not_capturable';

export interface CaptureError {
  error: CaptureErrorCode;
}

/** The color every agent-drawn overlay (boxes/masks/tracks) uses, reserved exclusively for that
 * purpose so a screenshot visually distinguishes "what the agent found" from UI chrome -- see
 * BoxOverlay.tsx and docs/design/DESIGN.md's visual rules. Duplicated here (rather than reading
 * `--color-annotate` from the DOM) because OffscreenCanvas 2D contexts have no computed-style
 * access and this value does not vary by theme. */
const ANNOTATE_COLOR = '#4fb3d9';

/** Draws normalized [0,1] box coordinates onto a canvas already sized to the captured frame, so
 * a capture with `includeOverlays:true` visually matches what BoxOverlay.tsx renders live. */
export function drawOverlays(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  boxes: Box[],
  canvasWidth: number,
  canvasHeight: number,
): void {
  ctx.strokeStyle = ANNOTATE_COLOR;
  ctx.lineWidth = 2;
  for (const box of boxes) {
    ctx.strokeRect(box.x * canvasWidth, box.y * canvasHeight, box.w * canvasWidth, box.h * canvasHeight);
  }
}

/**
 * Captures the exact currently-displayed frame of `video` into a Blob. Draws into an
 * OffscreenCanvas sized to the video's natural resolution (optionally downscaled to `maxWidth`),
 * then optionally composites overlays on top. A cross-origin video without permissive CORS taints
 * the canvas -- that failure only ever surfaces at `convertToBlob()` time (a `SecurityError`), not
 * at `drawImage()`, which silently succeeds either way (ported understanding from
 * ../agent-video-player/src/VideoContext.tsx:163-174's element lookup, adapted to the new
 * store-driven overlay data instead of a DOM query for rendered box elements).
 */
export async function captureCurrentFrame(video: HTMLVideoElement, options: CaptureOptions = {}): Promise<CaptureResult | CaptureError> {
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  if (!videoWidth || !videoHeight) {
    return { error: 'video_not_ready' };
  }

  const scale = options.maxWidth && options.maxWidth < videoWidth ? options.maxWidth / videoWidth : 1;
  const width = Math.round(videoWidth * scale);
  const height = Math.round(videoHeight * scale);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { error: 'video_not_ready' };
  }

  ctx.drawImage(video, 0, 0, width, height);
  if (options.boxes && options.boxes.length > 0) {
    drawOverlays(ctx, options.boxes, width, height);
  }

  try {
    const blob = await canvas.convertToBlob({ type: `image/${options.format ?? 'png'}` });
    return { blob, width, height };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') {
      return { error: 'source_not_capturable' };
    }
    throw error;
  }
}

const FORMAT_EXTENSION: Record<CaptureFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' };

/** `${name||'frame'}-${HH-MM-SS-mmm}.${ext}` per the plan's Task 5 Key Decisions -- e.g. a
 * capture at t=2.0s named "frame-2s" downloads as "frame-2s-00-02-000.png" (TS-003 step 1). */
export function captureFilename(time: number, name: string | undefined, format: CaptureFormat): string {
  const timecode = secsToTimecode(time).replace(':', '-').replace('.', '-');
  return `${name || 'frame'}-${timecode}.${FORMAT_EXTENSION[format]}`;
}
