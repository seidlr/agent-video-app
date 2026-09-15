import { describe, expect, it } from 'vitest';
import { chaptersToVttDataUrl, parseChaptersVtt } from '../../src/lib/chapters';

describe('chaptersToVttDataUrl', () => {
  it('sorts by start and encodes a data: URL vidstack can use as a <Track src>', () => {
    const url = chaptersToVttDataUrl([
      { id: 'b', start: 10, end: 20, title: 'Second' },
      { id: 'a', start: 0, end: 10, title: 'First' },
    ]);
    expect(url.startsWith('data:text/vtt;charset=utf-8,')).toBe(true);
    const decoded = decodeURIComponent(url.slice('data:text/vtt;charset=utf-8,'.length));
    expect(decoded).toBe('WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nFirst\n\n00:00:10.000 --> 00:00:20.000\nSecond\n');
  });
});

describe('parseChaptersVtt', () => {
  it('parses cues into {start,end,title} inputs for store.addChapter', () => {
    expect(parseChaptersVtt('WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nIntro\n')).toEqual([{ start: 0, end: 5, title: 'Intro' }]);
  });

  it('falls back to "Untitled" for a cue with no payload text', () => {
    expect(parseChaptersVtt('WEBVTT\n\n00:00:00.000 --> 00:00:05.000\n\n')).toEqual([{ start: 0, end: 5, title: 'Untitled' }]);
  });
});
