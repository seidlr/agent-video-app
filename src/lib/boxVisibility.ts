import type { Box, Track, TrackKeyframe } from './types';

const POINT_VISIBILITY_WINDOW = 0.5;

/** True when `box` should be drawn on the stage at `currentTime`. Pure, so it's cheaply testable
 * independent of BoxOverlay's rendering. */
export function isBoxVisibleAt(box: Pick<Box, 'time' | 'until'>, currentTime: number): boolean {
  if (box.until !== undefined) return currentTime >= box.time && currentTime <= box.until;
  return Math.abs(box.time - currentTime) <= POINT_VISIBILITY_WINDOW;
}

/**
 * Linearly interpolates a track's keyframe boxes at `time` (Task 7's `track` tool; BoxOverlay.tsx
 * uses this for any box with a `trackId` instead of the box's own static coordinates). Clamps to
 * the first/last keyframe outside the tracked range rather than extrapolating -- a scrub past the
 * end of a track should freeze at its last known position, not fly off in whatever direction the
 * last two keyframes happened to be moving. Returns `null` for a track with no keyframes at all
 * (shouldn't happen in practice -- trackFrames always seeds one at the starting box -- but keeps
 * this total rather than throwing on a malformed track).
 */
export function interpolateTrackBox(keyframes: TrackKeyframe[], time: number): Track['keyframes'][number]['box'] | null {
  if (keyframes.length === 0) return null;
  const first = keyframes[0] as TrackKeyframe;
  if (time <= first.time) return first.box;
  const last = keyframes[keyframes.length - 1] as TrackKeyframe;
  if (time >= last.time) return last.box;

  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i] as TrackKeyframe;
    const b = keyframes[i + 1] as TrackKeyframe;
    if (time >= a.time && time <= b.time) {
      const t = b.time === a.time ? 0 : (time - a.time) / (b.time - a.time);
      return {
        x: a.box.x + (b.box.x - a.box.x) * t,
        y: a.box.y + (b.box.y - a.box.y) * t,
        w: a.box.w + (b.box.w - a.box.w) * t,
        h: a.box.h + (b.box.h - a.box.h) * t,
      };
    }
  }
  return last.box;
}
