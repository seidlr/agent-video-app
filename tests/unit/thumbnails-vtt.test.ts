import { describe, expect, it } from 'vitest';
import { buildFilmstripTileStyles, buildThumbnailsVtt, pickThumbnailTimestamps } from '../../src/media/thumbnails';

describe('pickThumbnailTimestamps', () => {
  it('spreads `count` timestamps evenly across the duration, centered in each slice', () => {
    // 8s / 4 = 2s slices, centered at 1, 3, 5, 7 -- matches the fixture's 4 two-second color scenes.
    expect(pickThumbnailTimestamps(8, { count: 4 })).toEqual([1, 3, 5, 7]);
  });

  it('defaults to 10 timestamps when neither count nor intervalSeconds is given', () => {
    expect(pickThumbnailTimestamps(10, {})).toHaveLength(10);
  });

  it('uses a fixed interval instead of count when intervalSeconds is given', () => {
    expect(pickThumbnailTimestamps(10, { intervalSeconds: 2 })).toEqual([0, 2, 4, 6, 8]);
  });

  it('clamps count to at least 1', () => {
    expect(pickThumbnailTimestamps(8, { count: 0 })).toEqual([4]);
  });
});

describe('buildThumbnailsVtt', () => {
  it('produces one cue per timestamp with #xywh pointing at its tile position', () => {
    const vtt = buildThumbnailsVtt({
      timestamps: [1, 3],
      duration: 4,
      tileWidth: 160,
      tileHeight: 90,
      columns: 10,
    });

    expect(vtt).toBe(
      'WEBVTT\n\n' +
        '00:00:01.000 --> 00:00:03.000\n' +
        'sprite.webp#xywh=0,0,160,90\n\n' +
        '00:00:03.000 --> 00:00:04.000\n' +
        'sprite.webp#xywh=160,0,160,90\n',
    );
  });

  it('wraps to a new row once a row fills up (columns:10)', () => {
    const timestamps = Array.from({ length: 12 }, (_, i) => i);
    const vtt = buildThumbnailsVtt({ timestamps, duration: 12, tileWidth: 160, tileHeight: 90, columns: 10 });
    const cues = vtt.split('\n\n').filter((c) => c.startsWith('00'));
    expect(cues).toHaveLength(12);
    expect(cues[9]).toContain('sprite.webp#xywh=1440,0,160,90'); // last cell of row 0 (index 9)
    expect(cues[10]).toContain('sprite.webp#xywh=0,90,160,90'); // first cell of row 1 (index 10)
  });

  it('returns exactly one cue for a single timestamp, ending at duration', () => {
    const vtt = buildThumbnailsVtt({ timestamps: [2], duration: 5, tileWidth: 160, tileHeight: 90, columns: 10 });
    expect(vtt).toBe('WEBVTT\n\n00:00:02.000 --> 00:00:05.000\nsprite.webp#xywh=0,0,160,90\n');
  });
});

describe('buildFilmstripTileStyles', () => {
  it('returns an empty array for no timestamps', () => {
    expect(buildFilmstripTileStyles([])).toEqual([]);
  });

  it('places a single tile at 0%/0% covering exactly one tile-width/-height (100%/100%)', () => {
    expect(buildFilmstripTileStyles([2])).toEqual([{ time: 2, backgroundPosition: '0% 0%', backgroundSize: '100% 100%' }]);
  });

  it('spreads a single row of tiles across 0%-100% so each index lands on its own cell', () => {
    // 4 tiles, one row: background-size 400% means the sprite renders at 4 tile-widths, and each
    // step of 100/3% moves the crop over by exactly one tile-width (the standard CSS
    // sprite-scaling identity: offsetPx = (renderedSize - boxSize) * pct/100).
    const styles = buildFilmstripTileStyles([1, 3, 5, 7], 10);
    expect(styles.map((s) => s.backgroundSize)).toEqual(['400% 100%', '400% 100%', '400% 100%', '400% 100%']);
    expect(styles.map((s) => s.backgroundPosition)).toEqual(['0% 0%', '33.33333333333333% 0%', '66.66666666666666% 0%', '100% 0%']);
  });

  it('wraps to a second row at columns:10 and offsets both axes (12 tiles, matches buildThumbnailsVtt row-wrap)', () => {
    const timestamps = Array.from({ length: 12 }, (_, i) => i);
    const styles = buildFilmstripTileStyles(timestamps, 10);
    expect(styles).toHaveLength(12);
    // Grid is 10 cols x 2 rows regardless of the last row only having 2 tiles (matches the actual
    // composited sprite's fixed 10-wide canvas from generateThumbnailSprite).
    expect(styles[0]).toEqual({ time: 0, backgroundPosition: '0% 0%', backgroundSize: '1000% 200%' });
    expect(styles[9]).toEqual({ time: 9, backgroundPosition: '100% 0%', backgroundSize: '1000% 200%' });
    expect(styles[10]).toEqual({ time: 10, backgroundPosition: '0% 100%', backgroundSize: '1000% 200%' });
    expect(styles[11]).toEqual({ time: 11, backgroundPosition: '11.11111111111111% 100%', backgroundSize: '1000% 200%' });
  });
});
