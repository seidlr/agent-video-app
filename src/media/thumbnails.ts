import { CanvasSink } from 'mediabunny';
import { formatTime } from '../lib/time';
import { getInput } from './input';
import type { ResolvedSource } from './source';

/** Sprite tile width in pixels; height is derived from the video's own aspect ratio. Matches the
 * plan's Key Decisions for Task 5. */
export const THUMBNAIL_TILE_WIDTH = 160;
/** Tiles per sprite row, same layout convention as files.vidstack.io/sprite-fight/thumbnails.vtt. */
export const THUMBNAIL_COLUMNS = 10;

export interface PickTimestampsOptions {
  count?: number;
  intervalSeconds?: number;
}

/** Chooses which timestamps to thumbnail: either `count` slices spread evenly across the
 * duration (each timestamp centered in its slice, so a full-video pass never starts or ends
 * exactly on a boundary frame), or one every `intervalSeconds` when given instead. */
export function pickThumbnailTimestamps(duration: number, options: PickTimestampsOptions): number[] {
  if (options.intervalSeconds && options.intervalSeconds > 0) {
    const timestamps: number[] = [];
    for (let t = 0; t < duration; t += options.intervalSeconds) timestamps.push(t);
    return timestamps;
  }
  const count = Math.max(1, options.count ?? 10);
  return Array.from({ length: count }, (_, i) => (duration * (i + 0.5)) / count);
}

export interface BuildVttOptions {
  timestamps: number[];
  duration: number;
  tileWidth: number;
  tileHeight: number;
  columns: number;
}

/** Builds a sprite VTT (`#xywh=` cues), the same format `files.vidstack.io/sprite-fight/thumbnails.vtt`
 * uses, so the Timeline's existing `TimeSlider.Thumbnail` component (Task 3) works unmodified for
 * a locally-generated sprite too. Each cue spans from its own timestamp to the next one's (or to
 * `duration` for the last). Pure and browser-independent -- the actual pixel compositing lives in
 * generateThumbnailSprite below. */
export function buildThumbnailsVtt(options: BuildVttOptions): string {
  const { timestamps, duration, tileWidth, tileHeight, columns } = options;
  const cues = timestamps.map((start, index) => {
    const end = timestamps[index + 1] ?? duration;
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = col * tileWidth;
    const y = row * tileHeight;
    return `${formatTime(start)} --> ${formatTime(end)}\nsprite.webp#xywh=${x},${y},${tileWidth},${tileHeight}`;
  });
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

export interface FilmstripTileStyle {
  time: number;
  backgroundPosition: string;
  backgroundSize: string;
}

/**
 * Turns thumbnail timestamps into per-tile CSS for a responsive sprite-crop filmstrip
 * (Timeline/Filmstrip.tsx): each timestamp becomes one flex tile whose `background-size`/
 * `-position` are expressed as percentages of the TILE's own box rather than fixed pixels, so the
 * crop stays exact no matter how large the strip is rendered -- the standard CSS sprite-scaling
 * technique (`background-size: N00%` scales the sprite to N tile-widths/heights; `background-
 * position: P%` then lands exactly on tile index i via `P = i/(N-1)*100`, since a percentage
 * position offsets by `(renderedSize - boxSize) * P/100`, which resolves to exactly `i` tile
 * widths/heights of offset). Pure and layout-only -- doesn't need the actual sprite/tile pixel
 * dimensions, only how many columns wide the grid is (same `columns` `buildThumbnailsVtt` used).
 */
export function buildFilmstripTileStyles(timestamps: number[], columns: number = THUMBNAIL_COLUMNS): FilmstripTileStyle[] {
  if (timestamps.length === 0) return [];
  const cols = Math.min(columns, timestamps.length);
  const rows = Math.ceil(timestamps.length / columns);
  return timestamps.map((time, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const xPct = cols > 1 ? (col / (cols - 1)) * 100 : 0;
    const yPct = rows > 1 ? (row / (rows - 1)) * 100 : 0;
    return { time, backgroundPosition: `${xPct}% ${yPct}%`, backgroundSize: `${cols * 100}% ${rows * 100}%` };
  });
}

export interface GenerateThumbnailsOptions extends PickTimestampsOptions {
  /** Also add the full sprite as a single labelled frame in the Frames tray (Task 5's
   * `generate_thumbnails` tool option). Handled by the caller (src/agent/tools/frames.ts), which
   * already has access to the store -- this module only produces the sprite/VTT/timestamps. */
  contactSheet?: boolean;
}

export interface ThumbnailSpriteResult {
  spriteBlob: Blob;
  vtt: string;
  timestamps: number[];
  tileWidth: number;
  tileHeight: number;
}

/**
 * Generates a thumbnail sprite (one WebP image tiling every requested frame) and its VTT for
 * `source`, via a cached mediabunny `Input` (see input.ts). Browser-only: needs OffscreenCanvas
 * and mediabunny's WebCodecs-backed CanvasSink, neither available in Node -- verified instead by
 * tests/e2e/frames.spec.ts against the real fixture. YouTube has no direct pixel access at all;
 * callers use the 4 free ytimg stills (already wired into ResolvedSource.filmstripUrls, Task 3)
 * instead of calling this function for a YouTube source.
 */
export async function generateThumbnailSprite(source: ResolvedSource, options: GenerateThumbnailsOptions = {}): Promise<ThumbnailSpriteResult> {
  const input = await getInput(source);
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('no_video_track: this source has no video track to generate thumbnails from');

  const duration = await input.computeDuration();
  const timestamps = pickThumbnailTimestamps(duration, options);
  const [displayWidth, displayHeight] = await Promise.all([track.getDisplayWidth(), track.getDisplayHeight()]);
  const tileHeight = Math.round(THUMBNAIL_TILE_WIDTH * (displayHeight / displayWidth));

  const columns = Math.min(THUMBNAIL_COLUMNS, timestamps.length);
  const rows = Math.ceil(timestamps.length / THUMBNAIL_COLUMNS);
  const sprite = new OffscreenCanvas(THUMBNAIL_TILE_WIDTH * columns, tileHeight * rows);
  const ctx = sprite.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable: could not get a 2D context for the thumbnail sprite');

  const sink = new CanvasSink(track, { width: THUMBNAIL_TILE_WIDTH, fit: 'cover', poolSize: 2 });
  let index = 0;
  for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
    if (wrapped) {
      const col = index % THUMBNAIL_COLUMNS;
      const row = Math.floor(index / THUMBNAIL_COLUMNS);
      ctx.drawImage(wrapped.canvas, col * THUMBNAIL_TILE_WIDTH, row * tileHeight, THUMBNAIL_TILE_WIDTH, tileHeight);
    }
    index++;
  }

  const spriteBlob = await sprite.convertToBlob({ type: 'image/webp', quality: 0.82 });
  const vtt = buildThumbnailsVtt({ timestamps, duration, tileWidth: THUMBNAIL_TILE_WIDTH, tileHeight, columns: THUMBNAIL_COLUMNS });

  return { spriteBlob, vtt, timestamps, tileWidth: THUMBNAIL_TILE_WIDTH, tileHeight };
}
