import { describe, expect, it } from 'vitest';
import { interpolateTrackBox, isBoxVisibleAt } from '../../src/lib/boxVisibility';

describe('isBoxVisibleAt', () => {
  it('a point box (no "until") is visible within 0.5s of its timestamp', () => {
    expect(isBoxVisibleAt({ time: 10 }, 10.4)).toBe(true);
    expect(isBoxVisibleAt({ time: 10 }, 9.6)).toBe(true);
    expect(isBoxVisibleAt({ time: 10 }, 10.6)).toBe(false);
  });

  it('a ranged box (with "until") is visible for its whole [time, until] span', () => {
    expect(isBoxVisibleAt({ time: 5, until: 20 }, 5)).toBe(true);
    expect(isBoxVisibleAt({ time: 5, until: 20 }, 12)).toBe(true);
    expect(isBoxVisibleAt({ time: 5, until: 20 }, 20)).toBe(true);
    expect(isBoxVisibleAt({ time: 5, until: 20 }, 4.9)).toBe(false);
    expect(isBoxVisibleAt({ time: 5, until: 20 }, 20.1)).toBe(false);
  });
});

describe('interpolateTrackBox', () => {
  const keyframes = [
    { time: 0, box: { x: 0.1, y: 0.2, w: 0.1, h: 0.1 } },
    { time: 1, box: { x: 0.3, y: 0.2, w: 0.1, h: 0.1 } },
    { time: 2, box: { x: 0.3, y: 0.4, w: 0.2, h: 0.1 } },
  ];

  it('returns null for a track with no keyframes', () => {
    expect(interpolateTrackBox([], 1)).toBeNull();
  });

  it('returns the exact keyframe box when time lands exactly on one', () => {
    expect(interpolateTrackBox(keyframes, 1)).toEqual({ x: 0.3, y: 0.2, w: 0.1, h: 0.1 });
  });

  it('linearly interpolates between the two surrounding keyframes', () => {
    expect(interpolateTrackBox(keyframes, 0.5)).toEqual({ x: 0.2, y: 0.2, w: 0.1, h: 0.1 });

    const midway = interpolateTrackBox(keyframes, 1.5);
    expect(midway?.x).toBeCloseTo(0.3, 10);
    expect(midway?.y).toBeCloseTo(0.3, 10);
    expect(midway?.w).toBeCloseTo(0.15, 10);
    expect(midway?.h).toBeCloseTo(0.1, 10);
  });

  it('clamps to the first keyframe before the track starts', () => {
    expect(interpolateTrackBox(keyframes, -5)).toEqual({ x: 0.1, y: 0.2, w: 0.1, h: 0.1 });
  });

  it('clamps to the last keyframe after the track ends', () => {
    expect(interpolateTrackBox(keyframes, 50)).toEqual({ x: 0.3, y: 0.4, w: 0.2, h: 0.1 });
  });
});
