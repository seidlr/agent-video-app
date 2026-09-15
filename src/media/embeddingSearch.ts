/**
 * Pure cosine-similarity search shared by Task 8's two embedding-backed tools: `search_frames`
 * (MobileCLIP text-to-image) and `find_similar_frames {method:'dino'}` (DINOv3 patch-mean
 * image-to-image). Kept out of ml/embed.worker.ts so it's unit-testable without a real model,
 * same split as media/dhash.ts+media/scenes.ts's pure/impure separation.
 */

/** Cosine similarity in [-1,1] (in practice [0,1] for these non-negative-ish embedding spaces).
 * Returns 0 for either zero vector rather than dividing by zero. */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface EmbeddingSample {
  time: number;
  vector: ArrayLike<number>;
}

export interface ScoredRange {
  start: number;
  end: number;
  score: number;
}

export interface FindTopRangesOptions {
  minScore?: number;
  /** Two hits farther apart than this start a new range instead of merging into the previous one
   * -- same purpose as media/scenes.ts's own `findSimilarRanges` option. */
  maxGapSeconds?: number;
}

const DEFAULT_MAX_GAP_SECONDS = 0.75;

/**
 * Scores every sample against `query` by cosine similarity, keeps hits at or above `minScore`,
 * and merges hits within `maxGapSeconds` of each other into one contiguous range (tracking the
 * best/highest score seen in that range) -- the shared "index -> ranked ranges" step both
 * embedding-backed tools need after computing their own query vector.
 */
export function findTopRanges(samples: EmbeddingSample[], query: ArrayLike<number>, options: FindTopRangesOptions = {}): ScoredRange[] {
  const minScore = options.minScore ?? 0;
  const maxGapSeconds = options.maxGapSeconds ?? DEFAULT_MAX_GAP_SECONDS;

  const hits = [...samples]
    .sort((a, b) => a.time - b.time)
    .map((s) => ({ time: s.time, score: cosineSimilarity(s.vector, query) }))
    .filter((h) => h.score >= minScore);

  if (hits.length === 0) return [];

  const ranges: ScoredRange[] = [];
  let current: ScoredRange = { start: hits[0]!.time, end: hits[0]!.time, score: hits[0]!.score };
  for (let i = 1; i < hits.length; i++) {
    const hit = hits[i]!;
    if (hit.time - current.end <= maxGapSeconds) {
      current.end = hit.time;
      current.score = Math.max(current.score, hit.score);
    } else {
      ranges.push(current);
      current = { start: hit.time, end: hit.time, score: hit.score };
    }
  }
  ranges.push(current);

  ranges.sort((a, b) => b.score - a.score);
  return ranges;
}
