/**
 * Pure per-pixel matte compositing for Task 13's background-removal feature, kept out of
 * ml/matting.worker.ts/media/export.ts so it's unit-testable without a real OffscreenCanvas -- same
 * split as media/depthStats.ts/dhash.ts. The one operation that genuinely needs a canvas (blurring
 * the background) is the caller's job: pass the already-blurred pixels in as `blurredRgba` rather
 * than have this function reach for `ctx.filter` itself.
 */
import type { MatteReplace, RgbColor } from '../lib/types';

export interface ApplyMatteOptions {
  replace: MatteReplace;
  /** Required (and only used) for `replace:'color'`. */
  color?: RgbColor;
  /** Required (and only used) for `replace:'blur'` -- the same width/height RGBA pixels as
   * `frameRgba`, pre-blurred by the caller (e.g. an OffscreenCanvas with `ctx.filter='blur(24px)'`). */
  blurredRgba?: Uint8ClampedArray;
}

/**
 * Composites `frameRgba` (the subject, RGBA) over a background chosen by `options.replace`, using
 * `alpha` (one value per pixel, 0-1, matting-model output) as the subject's own opacity: a pixel at
 * alpha=1 keeps the original frame untouched; a pixel at alpha=0 becomes fully transparent, a solid
 * color, or the corresponding pixel of `blurredRgba`, depending on `options.replace`. Intermediate
 * alpha values blend proportionally, matching the EMA-smoothed alpha this app's caller already
 * applies across frames to suppress flicker.
 */
export function applyMatte(frameRgba: Uint8ClampedArray, alpha: ArrayLike<number>, width: number, height: number, options: ApplyMatteOptions): Uint8ClampedArray {
  const out = new Uint8ClampedArray(frameRgba.length);
  const pixelCount = width * height;

  for (let p = 0; p < pixelCount; p++) {
    const i = p * 4;
    const a = alpha[p] ?? 0;
    const r = frameRgba[i] ?? 0;
    const g = frameRgba[i + 1] ?? 0;
    const b = frameRgba[i + 2] ?? 0;

    if (options.replace === 'transparent') {
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = Math.round(a * 255);
      continue;
    }

    let bgR: number;
    let bgG: number;
    let bgB: number;
    if (options.replace === 'color') {
      const color = options.color ?? { r: 0, g: 0, b: 0 };
      bgR = color.r;
      bgG = color.g;
      bgB = color.b;
    } else {
      bgR = options.blurredRgba?.[i] ?? r;
      bgG = options.blurredRgba?.[i + 1] ?? g;
      bgB = options.blurredRgba?.[i + 2] ?? b;
    }

    out[i] = Math.round(r * a + bgR * (1 - a));
    out[i + 1] = Math.round(g * a + bgG * (1 - a));
    out[i + 2] = Math.round(b * a + bgB * (1 - a));
    out[i + 3] = 255;
  }

  return out;
}

/** Keyed by the frame's own decode timestamp (milliseconds, rounded), not a sequential index --
 * `remove_background` (agent/tools/effects.ts) and this module's own caller in media/export.ts
 * both iterate the SAME `VideoSampleSink` over the SAME `Input`, so their frame timestamps line up
 * exactly (floating-point noise aside, which rounding to the millisecond absorbs); a sequential
 * index would only work if both passes were guaranteed to visit the exact same frame count in the
 * exact same order, which is not a guarantee this app makes anywhere else. Lives here (not in
 * agent/tools/effects.ts) so media/export.ts can read the same path scheme without importing
 * upward from the agent layer. */
export function matteFramePath(effectId: string, timestamp: number): string {
  return `cache/mattes/${effectId}/${Math.round(timestamp * 1000)}.png`;
}
