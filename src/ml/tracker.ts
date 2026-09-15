/**
 * Pure, browser-independent template tracking: given two already-decoded grayscale frames and a
 * pixel-space box in the first, finds the best-matching box position in the second via normalized
 * cross-correlation (NCC). Kept free of mediabunny/DOM/Worker dependencies so it can run (and be
 * tested) in plain Node -- the actual video-frame decoding and periodic SAM re-prompting live in
 * agent/tools/vision.ts's `track` tool, which is the integration layer this module is built for.
 */

export interface PixelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GrayFrame {
  data: Float32Array;
  width: number;
  height: number;
}

/** Rec. 601 luma from an RGBA (or RGB-only, alpha ignored) pixel buffer. */
export function toGrayscale(rgba: ArrayLike<number>, width: number, height: number): GrayFrame {
  const data = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    data[i] = 0.299 * (rgba[o] ?? 0) + 0.587 * (rgba[o + 1] ?? 0) + 0.114 * (rgba[o + 2] ?? 0);
  }
  return { data, width, height };
}

/**
 * Expands a box by `frac` of its own size on every side, clamped to the frame bounds. A tight
 * box around a solid-colored object (e.g. a fresh `segment` result) crops an internally-uniform
 * NCC template with no texture to correlate against -- normalizedCrossCorrelation reads zero
 * variance as "no signal" and reports 0 confidence, which looks identical to a real occlusion and
 * stops tracking on step one (confirmed live: tests/e2e/segment.spec.ts's track test against a
 * real segment()-produced box). Dilating first gives the template a border of surrounding
 * background for genuine contrast, matching the plan's own "re-prompt SAM with the dilated box
 * (10%)" Key Decision -- applied here to the NCC template directly rather than only at the SAM
 * re-prompt step this app's `track` doesn't perform (see vision.ts's own SHORTCUT note).
 */
export function dilatePixelBox(box: PixelBox, frac: number, frameWidth: number, frameHeight: number): PixelBox {
  const padX = Math.round(box.w * frac);
  const padY = Math.round(box.h * frac);
  const x = Math.max(0, box.x - padX);
  const y = Math.max(0, box.y - padY);
  const w = Math.min(frameWidth - x, box.w + padX * 2);
  const h = Math.min(frameHeight - y, box.h + padY * 2);
  return { x, y, w, h };
}

function clampBoxToFrame(box: PixelBox, frame: GrayFrame): PixelBox {
  const x = Math.min(Math.max(0, box.x), frame.width - box.w);
  const y = Math.min(Math.max(0, box.y), frame.height - box.h);
  return { x, y, w: box.w, h: box.h };
}

function cropRegion(frame: GrayFrame, box: PixelBox): Float32Array {
  const out = new Float32Array(box.w * box.h);
  for (let row = 0; row < box.h; row++) {
    const srcRow = (box.y + row) * frame.width + box.x;
    const dstRow = row * box.w;
    for (let col = 0; col < box.w; col++) {
      out[dstRow + col] = frame.data[srcRow + col] ?? 0;
    }
  }
  return out;
}

/** Zero-mean normalized cross-correlation, roughly in [-1, 1] (1 = identical pattern). A
 * near-uniform candidate region (denominator ~0 after mean-subtraction -- e.g. the tracked object
 * is gone and the window is flat background) has no reliable signal and reads as 0 rather than
 * NaN/Infinity from dividing by ~0. */
function normalizedCrossCorrelation(a: Float32Array, b: Float32Array): number {
  const n = a.length;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i] ?? 0;
    meanB += b[i] ?? 0;
  }
  meanA /= n;
  meanB /= n;

  let num = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < n; i++) {
    const da = (a[i] ?? 0) - meanA;
    const db = (b[i] ?? 0) - meanB;
    num += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  const denom = Math.sqrt(denomA * denomB);
  return denom < 1e-6 ? 0 : num / denom;
}

export interface TrackStep {
  box: PixelBox;
  /** The NCC peak at the winning position -- also this step's confidence. */
  confidence: number;
}

/**
 * One NCC step: crops `prevBox`'s content out of `prevFrame` as the template, then slides it over
 * a search window in `frame` (±`searchMarginFrac` of the box's own size, exhaustive integer-pixel
 * search) and returns the best-matching position.
 *
 * `searchMarginFrac` defaults to 0.6, not the plan's literal "±25%": confirmed live (tests/e2e/
 * segment.spec.ts's track test, against the actual fixture's known 160px/s square motion at
 * `stepSeconds:0.25` -> 40px of real movement per step) that 25% of even a dilated ~72px box
 * (±18px) is well short of a plausible per-step displacement, so the true position falls outside
 * the search window entirely and the best match found within it is a low-confidence false
 * positive -- indistinguishable from real occlusion, and tracking stops on step one. 60% (±43px
 * here) comfortably covers it while staying a fraction of the box's own size, not an unbounded
 * absolute pixel radius.
 *
 * SHORTCUT: the plan's Key Decisions describe a fixed 64x64 template on a 1/4-res search frame
 * (a real-world performance tuning for full-resolution video); this does a plain full-resolution,
 * box-sized-template search instead, which is correct for any resolution (including this test
 * suite's small synthetic frames, where a hardcoded 64px template wouldn't fit) but slower on a
 * large real frame with a large search margin. Upgrade trigger: `track`'s own `msPerStep` summary
 * (Key Decisions) shows a real box/frame combination taking too long per step in practice.
 */
export function nccAdvance(prevFrame: GrayFrame, frame: GrayFrame, prevBox: PixelBox, searchMarginFrac = 0.6): TrackStep {
  const box = clampBoxToFrame(prevBox, prevFrame);
  const template = cropRegion(prevFrame, box);
  const marginX = Math.max(1, Math.round(box.w * searchMarginFrac));
  const marginY = Math.max(1, Math.round(box.h * searchMarginFrac));

  let best: TrackStep = { box, confidence: -Infinity };
  for (let dy = -marginY; dy <= marginY; dy++) {
    const y = box.y + dy;
    if (y < 0 || y + box.h > frame.height) continue;
    for (let dx = -marginX; dx <= marginX; dx++) {
      const x = box.x + dx;
      if (x < 0 || x + box.w > frame.width) continue;
      const candidate = cropRegion(frame, { x, y, w: box.w, h: box.h });
      const confidence = normalizedCrossCorrelation(template, candidate);
      if (confidence > best.confidence) best = { box: { x, y, w: box.w, h: box.h }, confidence };
    }
  }
  return best;
}

/** A pluggable tracking method: `advance` takes the previous and current frame plus the box's
 * last known position and returns where it is now, with a confidence score. Task 8 registers
 * `'dino'` (DINOv3 patch-feature matching) once its embedding model exists; `'ncc'` is registered
 * below and needs no model download, so it's always available and stays the default. */
export interface TrackerStrategy {
  advance(prevFrame: GrayFrame, frame: GrayFrame, box: PixelBox): TrackStep;
}

const strategies = new Map<string, TrackerStrategy>();

export function registerTracker(name: string, strategy: TrackerStrategy): void {
  strategies.set(name, strategy);
}

export function getTracker(name: string): TrackerStrategy | undefined {
  return strategies.get(name);
}

export function listTrackers(): string[] {
  return [...strategies.keys()];
}

registerTracker('ncc', { advance: (prevFrame, frame, box) => nccAdvance(prevFrame, frame, box) });

/** Below this NCC peak, the match is no longer trustworthy (the object is occluded, left the
 * frame, or changed too much to correlate) -- per the plan's Key Decisions' "NCC peak < 0.5". */
export const NCC_CONFIDENCE_THRESHOLD = 0.5;

export interface TrackFramesOptions {
  strategy?: string;
  confidenceThreshold?: number;
}

export interface TrackFramesResult {
  keyframes: { index: number; box: PixelBox }[];
  stoppedAt?: number;
  reason?: 'low_confidence';
}

/**
 * Runs a registered tracker strategy across a sequence of already-decoded grayscale frames,
 * starting from `initialBox` in `frames[0]`. Stops the instant a step's confidence drops below
 * the threshold (occlusion, leaving the frame, or a low-texture region the correlation can't
 * lock onto) rather than continuing to drift on a match it can no longer trust.
 */
export function trackFrames(frames: GrayFrame[], initialBox: PixelBox, options: TrackFramesOptions = {}): TrackFramesResult {
  const strategyName = options.strategy ?? 'ncc';
  const strategy = getTracker(strategyName);
  if (!strategy) throw new Error(`method_unavailable: no tracker registered as "${strategyName}"`);
  const threshold = options.confidenceThreshold ?? NCC_CONFIDENCE_THRESHOLD;

  const keyframes: { index: number; box: PixelBox }[] = [{ index: 0, box: initialBox }];
  let box = initialBox;
  for (let i = 1; i < frames.length; i++) {
    const step = strategy.advance(frames[i - 1] as GrayFrame, frames[i] as GrayFrame, box);
    if (step.confidence < threshold) {
      return { keyframes, stoppedAt: i, reason: 'low_confidence' };
    }
    box = step.box;
    keyframes.push({ index: i, box });
  }
  return { keyframes };
}
