import { describe, expect, it } from 'vitest';
import { downloadProgressCallback } from '../../src/ml/transformersCdn';

describe('downloadProgressCallback', () => {
  it('reports the aggregate across every file, so a multi-file model never jumps backwards per file', () => {
    const seen: number[] = [];
    const cb = downloadProgressCallback((f) => seen.push(f));
    // transformers.js v4 emits progress_total *before* the per-file progress it aggregates.
    cb({ status: 'progress_total', loaded: 1, total: 100 });
    cb({ status: 'progress', loaded: 1, total: 1 }); // a tiny config file finishing: 100% of *that file*
    cb({ status: 'progress_total', loaded: 26, total: 100 });
    cb({ status: 'progress', loaded: 25, total: 99 });
    cb({ status: 'progress_total', loaded: 100, total: 100 });
    expect(seen).toEqual([0.01, 0.26, 1]);
  });

  it('falls back to per-file progress when the runtime does not emit an aggregate', () => {
    const seen: number[] = [];
    const cb = downloadProgressCallback((f) => seen.push(f));
    cb({ status: 'initiate' });
    cb({ status: 'progress', loaded: 50, total: 200 });
    expect(seen).toEqual([0.25]);
  });
});
