import { describe, expect, it } from 'vitest';
import { dilatePixelBox, getTracker, listTrackers, nccAdvance, toGrayscale, trackFrames, type GrayFrame, type PixelBox } from '../../src/ml/tracker';

const WIDTH = 100;
const HEIGHT = 100;
const SQUARE = 20;
const BG = 30;
const FG = 220;
// The tracking box is padded past the square itself so its cropped template has real internal
// contrast (background border + bright interior) for NCC to correlate against -- a box exactly
// matching a solid-color square crops a template with zero internal variance, which is
// undefined/degenerate for normalized cross-correlation (correctly reads as "no signal" and would
// make every test below meaningless, not just the occlusion one).
const MARGIN = 8;
const BOX_SIZE = SQUARE + MARGIN * 2;

/** A synthetic grayscale frame: a flat background with an optional bright square at
 * (squareX, squareY). `present:false` simulates the tracked object being fully occluded/removed. */
function makeFrame(squareX: number, squareY: number, present = true): GrayFrame {
  const data = new Float32Array(WIDTH * HEIGHT).fill(BG);
  if (present) {
    for (let y = squareY; y < squareY + SQUARE; y++) {
      for (let x = squareX; x < squareX + SQUARE; x++) {
        data[y * WIDTH + x] = FG;
      }
    }
  }
  return { data, width: WIDTH, height: HEIGHT };
}

/** The tracking box for a square at (squareX, squareY): padded by MARGIN on every side. */
function boxAround(squareX: number, squareY: number): PixelBox {
  return { x: squareX - MARGIN, y: squareY - MARGIN, w: BOX_SIZE, h: BOX_SIZE };
}

describe('toGrayscale', () => {
  it('converts RGBA to Rec.601 luma', () => {
    // Pure red (255,0,0) -> 0.299*255 ~= 76.245; pure white (255,255,255) -> 255.
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 255, 255, 255, 255]);
    const gray = toGrayscale(rgba, 2, 1);
    expect(gray.data[0]).toBeCloseTo(76.245, 2);
    expect(gray.data[1]).toBeCloseTo(255, 2);
  });
});

describe('nccAdvance', () => {
  it('finds a perfect match (confidence ~1) when the template reappears unchanged', () => {
    const prev = makeFrame(10, 40);
    const same = makeFrame(10, 40);
    const step = nccAdvance(prev, same, boxAround(10, 40));
    expect(step.confidence).toBeCloseTo(1, 5);
    expect(step.box).toEqual(boxAround(10, 40));
  });

  it('locates a shifted square within the search window', () => {
    const prev = makeFrame(10, 40);
    const shifted = makeFrame(12, 40);
    const step = nccAdvance(prev, shifted, boxAround(10, 40));
    expect(step.box).toEqual(boxAround(12, 40));
    expect(step.confidence).toBeGreaterThan(0.9);
  });

  it('registers "ncc" as an always-available tracker strategy', () => {
    expect(listTrackers()).toContain('ncc');
    expect(getTracker('ncc')).toBeDefined();
  });
});

describe('trackFrames (Task 7 DoD: tracker.test.ts)', () => {
  it('DoD: a translated square is tracked within 2px over 10 steps', () => {
    // 10 frames (indices 0-9), square moving +2px/frame in x from x=10.
    const frames: GrayFrame[] = Array.from({ length: 10 }, (_, i) => makeFrame(10 + i * 2, 40));
    const initialBox = boxAround(10, 40);

    const result = trackFrames(frames, initialBox);

    expect(result.stoppedAt).toBeUndefined();
    expect(result.keyframes).toHaveLength(10);
    result.keyframes.forEach((kf, i) => {
      const expected = boxAround(10 + i * 2, 40);
      expect(Math.abs(kf.box.x - expected.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(kf.box.y - expected.y)).toBeLessThanOrEqual(2);
    });
  });

  it('DoD: occlusion (square removed) yields NCC peak < 0.5 and stops', () => {
    const frames: GrayFrame[] = [
      makeFrame(10, 40),
      makeFrame(12, 40),
      makeFrame(14, 40),
      makeFrame(16, 40, false), // occluded: the square is gone, just flat background
    ];
    const initialBox = boxAround(10, 40);

    const result = trackFrames(frames, initialBox);

    expect(result.reason).toBe('low_confidence');
    expect(result.stoppedAt).toBe(3);
    // Tracked correctly through the frames where the square was still visible.
    expect(result.keyframes).toHaveLength(3);
    expect(result.keyframes[2]).toEqual({ index: 2, box: boxAround(14, 40) });
  });

  it('throws method_unavailable for an unregistered tracker strategy', () => {
    const frames: GrayFrame[] = [makeFrame(10, 40), makeFrame(10, 40)];
    expect(() => trackFrames(frames, boxAround(10, 40), { strategy: 'dino' })).toThrow('method_unavailable');
  });
});

describe('dilatePixelBox', () => {
  it('expands a box by frac on every side', () => {
    expect(dilatePixelBox({ x: 20, y: 30, w: 10, h: 20 }, 0.1, 1000, 1000)).toEqual({ x: 19, y: 28, w: 12, h: 24 });
  });

  it('clamps the position to 0 rather than going negative, without needing to shrink w/h', () => {
    // A huge frame never needs to shrink the dilated size, only clamp x/y at the near edge.
    expect(dilatePixelBox({ x: 0, y: 0, w: 10, h: 10 }, 0.5, 1000, 1000)).toEqual({ x: 0, y: 0, w: 20, h: 20 });
  });

  it('clamps w/h so the dilated box never runs past the far edge of the frame', () => {
    expect(dilatePixelBox({ x: 90, y: 90, w: 10, h: 10 }, 0.5, 100, 100)).toEqual({ x: 85, y: 85, w: 15, h: 15 });
  });

  it("DoD-adjacent: a dilated tight square template can lock onto itself with real confidence (unlike a tight, uniform one)", () => {
    // Reproduces the real bug tests/e2e/segment.spec.ts's track test caught: a fresh segment()
    // result is a *tight* box around a solid-colored object, which crops an internally-uniform
    // (zero-variance) NCC template that reads as "no signal". Dilating first gives it a
    // background border to correlate against.
    const size = 100;
    const bg = 30;
    const fg = 220;
    function frame(): GrayFrame {
      const data = new Float32Array(size * size).fill(bg);
      for (let y = 40; y < 60; y++) for (let x = 40; x < 60; x++) data[y * size + x] = fg;
      return { data, width: size, height: size };
    }
    const tightBox: PixelBox = { x: 40, y: 40, w: 20, h: 20 };
    const dilated = dilatePixelBox(tightBox, 0.5, size, size); // {x:30,y:30,w:30,h:30}

    const tightStep = nccAdvance(frame(), frame(), tightBox);
    const dilatedStep = nccAdvance(frame(), frame(), dilated);

    expect(tightStep.confidence).toBe(0); // uniform template: no signal, exactly the bug
    expect(dilatedStep.confidence).toBeCloseTo(1, 5); // background border gives real contrast
  });
});
