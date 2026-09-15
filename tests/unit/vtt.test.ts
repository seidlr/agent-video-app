import { describe, expect, it } from 'vitest';
import { buildVttString, parseVtt } from '../../src/lib/vtt';

// The old default chapters VTT from ../agent-video-player/src/VideoContext.tsx:75, used by both
// Task 6 DoD lines: "round-trips the old default VTT" (this file) and parses 1:05.5 --> 1:10.
const OLD_DEFAULT_VTT = 'WEBVTT\n\n00:00:00.000 --> 00:01:13.000\nThe Forest\n\n00:01:13.000 --> 00:02:31.000\nCamp Site\n\n00:02:31.000 --> 00:04:00.000\nThe Sprites\n';

describe('parseVtt', () => {
  it('round-trips the old default VTT (The Forest / Camp Site / The Sprites)', () => {
    const cues = parseVtt(OLD_DEFAULT_VTT);
    expect(cues).toEqual([
      { start: 0, end: 73, text: 'The Forest' },
      { start: 73, end: 151, text: 'Camp Site' },
      { start: 151, end: 240, text: 'The Sprites' },
    ]);
    expect(buildVttString(cues.map((c) => ({ start: c.start, end: c.end, text: c.text })))).toBe(OLD_DEFAULT_VTT);
  });

  it('parses bare M:SS(.mmm) cues, not just H:MM:SS.mmm', () => {
    const cues = parseVtt('WEBVTT\n\n1:05.5 --> 1:10\nShort clip\n');
    expect(cues).toEqual([{ start: 65.5, end: 70, text: 'Short clip' }]);
  });

  it('joins a multi-line cue payload into one text string', () => {
    const cues = parseVtt('WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nLine one\nLine two\n');
    expect(cues).toEqual([{ start: 0, end: 2, text: 'Line one\nLine two' }]);
  });

  it('strips cue settings after the end timestamp', () => {
    const cues = parseVtt('WEBVTT\n\n00:00:00.000 --> 00:00:02.000 align:start line:0\nHello\n');
    expect(cues).toEqual([{ start: 0, end: 2, text: 'Hello' }]);
  });

  it('returns an empty array for a VTT with no cues', () => {
    expect(parseVtt('WEBVTT\n')).toEqual([]);
  });

  it('ignores a malformed timestamp line rather than throwing', () => {
    expect(parseVtt('WEBVTT\n\nnot a timestamp --> also not\nUnused\n')).toEqual([]);
  });
});

describe('buildVttString', () => {
  it('returns a bare WEBVTT header for no cues', () => {
    expect(buildVttString([])).toBe('WEBVTT\n');
  });

  it('formats a single cue with HH:MM:SS.mmm timestamps', () => {
    expect(buildVttString([{ start: 1.5, end: 3.25, text: 'Hi' }])).toBe('WEBVTT\n\n00:00:01.500 --> 00:00:03.250\nHi\n');
  });
});
