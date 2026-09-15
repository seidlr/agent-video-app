/**
 * Perceptual frame descriptors for `find_similar_frames` (Task 8): a 64-bit luma-gradient dHash
 * (fast, robust to compression noise, but blind to absolute color -- two different flat colors
 * hash identically since dHash only encodes "is this pixel brighter than its right neighbor") and
 * a quantized RGB color histogram to catch exactly that blind spot. The combined rule
 * (`hamming(dhash) small` AND `chi2(hist) small`) is what actually distinguishes two solid-color
 * scenes that would otherwise collide. Pure and browser-independent -- the actual frame decoding
 * (mediabunny CanvasSink) lives in media/scenes.ts, this module's own consumer.
 */

const DHASH_COLS = 9;
const DHASH_ROWS = 8;

/** Box-filtered luma at (col,row) of a `cols`x`rows` grid over an RGBA buffer of the given
 * pixel dimensions -- the same downsampling a resize-then-grayscale step would produce, done
 * directly against the source resolution rather than requiring a pre-resized image. */
function sampleLuma(rgba: ArrayLike<number>, width: number, height: number, cols: number, rows: number): Float64Array {
  const luma = new Float64Array(cols * rows);
  for (let ry = 0; ry < rows; ry++) {
    const y0 = Math.floor((ry / rows) * height);
    const y1 = Math.max(y0 + 1, Math.floor(((ry + 1) / rows) * height));
    for (let rx = 0; rx < cols; rx++) {
      const x0 = Math.floor((rx / cols) * width);
      const x1 = Math.max(x0 + 1, Math.floor(((rx + 1) / cols) * width));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * width + x) * 4;
          sum += 0.299 * (rgba[o] ?? 0) + 0.587 * (rgba[o + 1] ?? 0) + 0.114 * (rgba[o + 2] ?? 0);
          count++;
        }
      }
      luma[ry * cols + rx] = count > 0 ? sum / count : 0;
    }
  }
  return luma;
}

// Guards the `left > right` comparison below against floating-point accumulation noise: source
// dimensions rarely divide evenly into 9 columns, so sampleLuma's per-cell pixel counts vary
// (e.g. 7 vs 8 pixels wide), and summing the *same* luma value a different number of times before
// dividing can differ by a sliver of a float ULP even though the true averages are identical --
// confirmed empirically (a perfectly uniform-color frame produced a handful of spuriously-set
// bits without this). 1e-6 is far below any meaningful luma difference (luma itself is 0-255).
const DHASH_EPSILON = 1e-6;

/** The classic difference hash: resize to 9x8 luma, one bit per row per adjacent-pixel comparison
 * (9 columns -> 8 comparisons, 8 rows -> 64 bits total). A `bigint` rather than a Number since 64
 * bits exceeds JS's 53-bit safe integer range. */
export function dhash64(rgba: ArrayLike<number>, width: number, height: number): bigint {
  const luma = sampleLuma(rgba, width, height, DHASH_COLS, DHASH_ROWS);
  let hash = 0n;
  let bit = 0n;
  for (let row = 0; row < DHASH_ROWS; row++) {
    for (let col = 0; col < DHASH_COLS - 1; col++) {
      const left = luma[row * DHASH_COLS + col] ?? 0;
      const right = luma[row * DHASH_COLS + col + 1] ?? 0;
      if (left > right + DHASH_EPSILON) hash |= 1n << bit;
      bit++;
    }
  }
  return hash;
}

/** Popcount of the XOR -- the number of differing bits between two dHashes. */
export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

// A *joint* RGB histogram (R_BINS x G_BINS x B_BINS = 48 bins over the RGB cube), not three
// independent per-channel histograms. That distinction matters: with independent per-channel
// histograms, two pure colors that share one matching channel (e.g. red (255,0,0) and green
// (0,255,0) both have B=0) always keep that channel's bin fully overlapping, capping the maximum
// possible chi2 distance at 2/3 regardless of how different the other channels are -- short of
// the plan's own "chi2 >= 0.9" DoD line. A joint histogram puts every distinct color into exactly
// one cell of the cube, so two solid, different colors land in two disjoint bins and reach the
// true maximum distance (1.0). Blue gets fewer levels than red/green (a common, deliberate
// choice in color quantization -- human color discrimination is least sensitive in blue) to keep
// the total at exactly 48 while still resolving the perceptually-important axes at 4 levels each.
const HIST_R_BINS = 4;
const HIST_G_BINS = 4;
const HIST_B_BINS = 3;

function colorBin(value: number, bins: number): number {
  return Math.min(bins - 1, Math.floor((value / 256) * bins));
}

/** A 48-bin joint RGB color histogram (see the constants above), scaled to fit `Uint8Array` so
 * it's cheap to store in Dexie per sampled frame regardless of the source's actual pixel count. */
export function quantizeHist(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  const raw = new Float64Array(HIST_R_BINS * HIST_G_BINS * HIST_B_BINS);
  const pixelCount = width * height;
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    const rBin = colorBin(rgba[o] ?? 0, HIST_R_BINS);
    const gBin = colorBin(rgba[o + 1] ?? 0, HIST_G_BINS);
    const bBin = colorBin(rgba[o + 2] ?? 0, HIST_B_BINS);
    const index = rBin * (HIST_G_BINS * HIST_B_BINS) + gBin * HIST_B_BINS + bBin;
    (raw[index] as number) += 1;
  }
  let max = 1;
  for (const v of raw) if (v > max) max = v;
  return Uint8Array.from(raw, (v) => Math.round((v / max) * 255));
}

/** Chi-squared distance between two (already comparably-normalized) histograms, itself
 * normalizing each to a probability distribution first so histograms from differently-sized
 * source frames are still comparable. Result is in [0,1]: 0 for identical distributions, 1 for
 * completely disjoint ones (e.g. a histogram concentrated entirely in the red bins vs one
 * entirely in the green bins). */
export function chi2(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let totalA = 0;
  let totalB = 0;
  for (let i = 0; i < a.length; i++) {
    totalA += a[i] ?? 0;
    totalB += b[i] ?? 0;
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const pa = totalA > 0 ? (a[i] ?? 0) / totalA : 0;
    const pb = totalB > 0 ? (b[i] ?? 0) / totalB : 0;
    const denom = pa + pb;
    if (denom > 0) sum += (pa - pb) ** 2 / denom;
  }
  return sum / 2;
}
