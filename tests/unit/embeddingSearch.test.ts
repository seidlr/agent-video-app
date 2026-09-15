import { describe, expect, it } from 'vitest';
import { cosineSimilarity, findTopRanges } from '../../src/media/embeddingSearch';

describe('cosineSimilarity (Task 8: search_frames/find_similar_frames method:dino)', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it('is -1 for exactly opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  it('returns 0 for a zero vector rather than dividing by zero', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('findTopRanges (Task 8: shared embedding-index search)', () => {
  it('merges nearby hits into one range and rejects samples below minScore', () => {
    const query = [1, 0];
    const samples = [
      { time: 0, vector: [1, 0] }, // score 1
      { time: 0.25, vector: [0.9, 0.1] }, // still a strong match, close in time -> merges
      { time: 5, vector: [0, 1] }, // orthogonal -> below threshold, excluded
    ];
    const ranges = findTopRanges(samples, query, { minScore: 0.5, maxGapSeconds: 0.5 });
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.start).toBe(0);
    expect(ranges[0]!.end).toBe(0.25);
    expect(ranges[0]!.score).toBeCloseTo(1, 5);
  });

  it('keeps two hits separate when the gap between them exceeds maxGapSeconds', () => {
    const query = [1, 0];
    const samples = [
      { time: 0, vector: [1, 0] },
      { time: 10, vector: [1, 0] },
    ];
    const ranges = findTopRanges(samples, query, { minScore: 0.5, maxGapSeconds: 0.5 });
    expect(ranges).toHaveLength(2);
  });

  it('ranks ranges by score descending', () => {
    const query = [1, 0];
    const samples = [
      { time: 0, vector: [0.6, 0.8] }, // lower score
      { time: 10, vector: [1, 0] }, // perfect score, but later in time
    ];
    const ranges = findTopRanges(samples, query, { minScore: 0 });
    expect(ranges[0]!.start).toBe(10);
    expect(ranges[1]!.start).toBe(0);
  });

  it('returns an empty array when no sample clears minScore', () => {
    expect(findTopRanges([{ time: 0, vector: [0, 1] }], [1, 0], { minScore: 0.9 })).toEqual([]);
  });
});
