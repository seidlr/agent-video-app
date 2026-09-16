import { describe, expect, it } from 'vitest';
import { evenlySpacedTimestamps } from '../../src/media/vlmSamples';

describe('evenlySpacedTimestamps', () => {
  it('samples the midpoint for count=1', () => {
    expect(evenlySpacedTimestamps(0, 8, 1)).toEqual([4]);
  });

  it('always includes both endpoints for count>=2', () => {
    const timestamps = evenlySpacedTimestamps(0, 8, 4);
    expect(timestamps[0]).toBe(0);
    expect(timestamps.at(-1)).toBe(8);
    expect(timestamps).toHaveLength(4);
  });

  it('spaces timestamps evenly', () => {
    expect(evenlySpacedTimestamps(0, 9, 4)).toEqual([0, 3, 6, 9]);
  });
});
