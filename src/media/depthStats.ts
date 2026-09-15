/**
 * Pure statistics over a Depth Anything v2 `predicted_depth` map, kept out of ml/depth.worker.ts
 * so it's unit-testable without a real model -- same split as media/dhash.ts/media/audioEvents.ts.
 *
 * `predicted_depth`'s own value convention (confirmed against the official Depth-Anything-V2 repo
 * and HF `transformers`' post-processing, not assumed): it's inverse depth/disparity -- LARGER
 * raw values mean CLOSER to the camera, smaller values mean farther away.
 */

export interface DepthStats {
  near: number;
  far: number;
  mean: number;
  variance: number;
  shotType: 'close-up' | 'medium' | 'wide';
}

/** The plan's own Key Decisions: `shotType` is `close-up` when more than 40% of pixels fall in
 * the nearest 20% of the value range, `wide` when fewer than 10% do, else `medium`. */
const NEAR_BAND_FRACTION = 0.2;
const CLOSE_UP_THRESHOLD = 0.4;
const WIDE_THRESHOLD = 0.1;

export function computeDepthStats(data: ArrayLike<number>): DepthStats {
  if (data.length === 0) throw new Error('empty_depth_map: no pixels to summarize');

  let near = -Infinity;
  let far = Infinity;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] ?? 0;
    if (v > near) near = v;
    if (v < far) far = v;
    sum += v;
  }
  const mean = sum / data.length;

  let sqSum = 0;
  for (let i = 0; i < data.length; i++) sqSum += ((data[i] ?? 0) - mean) ** 2;
  const variance = sqSum / data.length;

  const range = near - far || 1;
  const nearBandThreshold = near - NEAR_BAND_FRACTION * range;
  let nearCount = 0;
  for (let i = 0; i < data.length; i++) if ((data[i] ?? 0) >= nearBandThreshold) nearCount++;
  const nearFraction = nearCount / data.length;

  const shotType: DepthStats['shotType'] = nearFraction > CLOSE_UP_THRESHOLD ? 'close-up' : nearFraction < WIDE_THRESHOLD ? 'wide' : 'medium';
  return { near, far, mean, variance, shotType };
}
