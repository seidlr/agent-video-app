import { describe, expect, it } from 'vitest';
import { chi2, dhash64, hamming, quantizeHist } from '../../src/media/dhash';

const WIDTH = 64;
const HEIGHT = 64;

/** A deterministic pseudo-random integer "texture" value in [0,255] for pixel (x,y) -- high
 * enough spatial frequency that every 9x8 dHash cell gets a genuinely distinct average luma,
 * unlike a smooth gradient (which risks many tied/near-tied adjacent-cell comparisons). */
function textureValue(x: number, y: number): number {
  const h = (x * 73856093) ^ (y * 19349663);
  return Math.abs(h) % 256;
}

/** RGBA buffer where R=G=B=textureValue(x+xOffset, y) (a grayscale texture), alpha=255. */
function makeTexturedFrame(xOffset = 0): Uint8ClampedArray {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const v = textureValue(x + xOffset, y);
      const o = (y * WIDTH + x) * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return data;
}

function makeSolidFrame(r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

function invertRgb(frame: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(frame.length);
  for (let i = 0; i < frame.length; i += 4) {
    out[i] = 255 - (frame[i] ?? 0);
    out[i + 1] = 255 - (frame[i + 1] ?? 0);
    out[i + 2] = 255 - (frame[i + 2] ?? 0);
    out[i + 3] = 255;
  }
  return out;
}

describe('dhash64/hamming (Task 8 DoD: dhash.test.ts)', () => {
  it('identical frames hash to hamming distance 0', () => {
    const frame = makeTexturedFrame();
    const a = dhash64(frame, WIDTH, HEIGHT);
    const b = dhash64(makeTexturedFrame(), WIDTH, HEIGHT);
    expect(hamming(a, b)).toBe(0);
  });

  it('a 1px-shifted textured frame stays within hamming <= 10', () => {
    const a = dhash64(makeTexturedFrame(0), WIDTH, HEIGHT);
    const b = dhash64(makeTexturedFrame(1), WIDTH, HEIGHT);
    expect(hamming(a, b)).toBeLessThanOrEqual(10);
  });

  it('uniform red vs uniform green collide at hamming 0 (documented dHash blind spot)', () => {
    const red = dhash64(makeSolidFrame(255, 0, 0), WIDTH, HEIGHT);
    const green = dhash64(makeSolidFrame(0, 255, 0), WIDTH, HEIGHT);
    expect(hamming(red, green)).toBe(0);
  });

  it('a textured frame vs its color-inverted twin diverges to hamming >= 20', () => {
    const original = makeTexturedFrame();
    const inverted = invertRgb(original);
    const a = dhash64(original, WIDTH, HEIGHT);
    const b = dhash64(inverted, WIDTH, HEIGHT);
    expect(hamming(a, b)).toBeGreaterThanOrEqual(20);
  });
});

describe('quantizeHist/chi2 (Task 8 DoD: dhash.test.ts)', () => {
  it('identical frames have chi2 distance 0', () => {
    const a = quantizeHist(makeTexturedFrame(), WIDTH, HEIGHT);
    const b = quantizeHist(makeTexturedFrame(), WIDTH, HEIGHT);
    expect(chi2(a, b)).toBe(0);
  });

  it('uniform red vs uniform green are chi2 >= 0.9 apart, rejecting the dHash collision above', () => {
    const red = quantizeHist(makeSolidFrame(255, 0, 0), WIDTH, HEIGHT);
    const green = quantizeHist(makeSolidFrame(0, 255, 0), WIDTH, HEIGHT);
    expect(chi2(red, green)).toBeGreaterThanOrEqual(0.9);
  });
});
