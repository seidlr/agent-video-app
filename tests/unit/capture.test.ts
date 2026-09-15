import { describe, expect, it } from 'vitest';
import { captureFilename, drawOverlays } from '../../src/media/capture';
import type { Box } from '../../src/lib/types';

function box(overrides: Partial<Box> = {}): Box {
  return { id: 'b1', time: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.4, label: 'test', source: 'agent', ...overrides };
}

function fakeCtx() {
  const calls: { method: string; args: unknown[] }[] = [];
  return {
    calls,
    set strokeStyle(v: string) {
      calls.push({ method: 'set strokeStyle', args: [v] });
    },
    set lineWidth(v: number) {
      calls.push({ method: 'set lineWidth', args: [v] });
    },
    strokeRect(...args: number[]) {
      calls.push({ method: 'strokeRect', args });
    },
  };
}

describe('captureFilename', () => {
  it('matches TS-003 step 1: "frame-2s" at t=2.0s downloads as "frame-2s-00-02-000.png"', () => {
    expect(captureFilename(2.0, 'frame-2s', 'png')).toBe('frame-2s-00-02-000.png');
  });

  it('defaults the name to "frame" when none is given', () => {
    expect(captureFilename(12.5, undefined, 'png')).toBe('frame-00-12-500.png');
  });

  it('maps jpeg to a .jpg extension and webp to .webp', () => {
    expect(captureFilename(0, 'x', 'jpeg')).toBe('x-00-00-000.jpg');
    expect(captureFilename(0, 'x', 'webp')).toBe('x-00-00-000.webp');
  });
});

describe('drawOverlays', () => {
  it('sets the reserved annotate color and strokes each box scaled to canvas pixels', () => {
    const ctx = fakeCtx();
    drawOverlays(ctx as unknown as CanvasRenderingContext2D, [box({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 })], 200, 100);

    expect(ctx.calls).toEqual([
      { method: 'set strokeStyle', args: ['#4fb3d9'] },
      { method: 'set lineWidth', args: [2] },
      { method: 'strokeRect', args: [20, 20, 60, 40] },
    ]);
  });

  it('draws nothing for an empty box list', () => {
    const ctx = fakeCtx();
    drawOverlays(ctx as unknown as CanvasRenderingContext2D, [], 200, 100);
    expect(ctx.calls.some((c) => c.method === 'strokeRect')).toBe(false);
  });

  it('draws one rect per box, in order', () => {
    const ctx = fakeCtx();
    drawOverlays(ctx as unknown as CanvasRenderingContext2D, [box({ x: 0, y: 0, w: 0.5, h: 0.5 }), box({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 })], 100, 100);
    const rects = ctx.calls.filter((c) => c.method === 'strokeRect').map((c) => c.args);
    expect(rects).toEqual([
      [0, 0, 50, 50],
      [50, 50, 50, 50],
    ]);
  });
});
