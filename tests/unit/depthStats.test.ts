import { describe, expect, it } from 'vitest';
import { computeDepthStats } from '../../src/media/depthStats';

describe('computeDepthStats (Task 8 DoD: estimate_depth)', () => {
  it('reports near as the max value and far as the min value (larger = closer)', () => {
    const stats = computeDepthStats([1, 5, 3, 0.5, 4]);
    expect(stats.near).toBe(5);
    expect(stats.far).toBe(0.5);
    expect(stats.mean).toBeCloseTo((1 + 5 + 3 + 0.5 + 4) / 5, 6);
  });

  it('classifies a shot as close-up when >40% of pixels are in the nearest 20% band', () => {
    // range is [0,10]; nearest 20% band is [8,10]. 60% of the values (6 of 10) fall in it.
    const data = [10, 9, 8.5, 9.2, 8.1, 8.8, 0, 1, 2, 3];
    const stats = computeDepthStats(data);
    expect(stats.shotType).toBe('close-up');
  });

  it('classifies a shot as wide when <10% of pixels are in the nearest 20% band', () => {
    // range [0,10]; nearest 20% band is [8,10]. Only 1 of 20 values (5%) falls in it.
    const data = [10, ...Array(19).fill(0)];
    const stats = computeDepthStats(data);
    expect(stats.shotType).toBe('wide');
  });

  it('classifies a shot as medium otherwise', () => {
    // range [0,10]; nearest 20% band is [8,10]. 2 of 10 values (20%) fall in it -- between the
    // wide (<10%) and close-up (>40%) thresholds.
    const data = [10, 9, 5, 4, 3, 2, 1, 0.5, 0.2, 0];
    const stats = computeDepthStats(data);
    expect(stats.shotType).toBe('medium');
  });

  it('throws a clear error for an empty depth map rather than returning NaN stats', () => {
    expect(() => computeDepthStats([])).toThrow(/empty_depth_map/);
  });
});
