import { describe, expect, it } from 'vitest';
import { applyMatte } from '../../src/media/composite';

/** A 2x1 RGBA frame: pixel 0 (foreground, alpha=1) is white; pixel 1 (background, alpha=0) is red.
 * Real remove_background output looks like this along a subject's edge -- the DoD's own "white
 * center pixel and a green corner pixel" fixture is exactly this shape at a bigger scale. */
function twoPixelFrame(): Uint8ClampedArray {
  return new Uint8ClampedArray([255, 255, 255, 255, 255, 0, 0, 255]);
}

describe('applyMatte (Task 13 DoD)', () => {
  it('keeps the foreground pixel and makes the background pixel transparent for replace:"transparent"', () => {
    const frame = twoPixelFrame();
    const alpha = new Float32Array([1, 0]);
    const out = applyMatte(frame, alpha, 2, 1, { replace: 'transparent' });

    expect(Array.from(out.slice(0, 4))).toEqual([255, 255, 255, 255]);
    expect(Array.from(out.slice(4, 8))).toEqual([255, 0, 0, 0]); // original RGB kept, alpha=0
  });

  it('keeps the foreground pixel and fills the background pixel with the replacement color', () => {
    const frame = twoPixelFrame();
    const alpha = new Float32Array([1, 0]);
    const out = applyMatte(frame, alpha, 2, 1, { replace: 'color', color: { r: 0, g: 255, b: 0 } });

    expect(Array.from(out.slice(0, 4))).toEqual([255, 255, 255, 255]);
    expect(Array.from(out.slice(4, 8))).toEqual([0, 255, 0, 255]);
  });

  it('keeps the foreground pixel and uses the pre-blurred pixel for the background', () => {
    const frame = twoPixelFrame();
    const alpha = new Float32Array([1, 0]);
    const blurredRgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    const out = applyMatte(frame, alpha, 2, 1, { replace: 'blur', blurredRgba });

    expect(Array.from(out.slice(0, 4))).toEqual([255, 255, 255, 255]);
    expect(Array.from(out.slice(4, 8))).toEqual([40, 50, 60, 255]);
  });

  it('blends partial alpha proportionally against the replacement color', () => {
    const frame = new Uint8ClampedArray([200, 100, 0, 255]);
    const alpha = new Float32Array([0.5]);
    const out = applyMatte(frame, alpha, 1, 1, { replace: 'color', color: { r: 0, g: 0, b: 0 } });

    expect(Array.from(out)).toEqual([100, 50, 0, 255]);
  });
});
