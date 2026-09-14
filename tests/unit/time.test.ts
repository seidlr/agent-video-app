import { describe, expect, it } from 'vitest';
import { formatTime, frameToTime, parseTime, secsToTimecode } from '../../src/lib/time';

const ctx = { duration: 100, currentTime: 10, fps: 30 };

describe('parseTime', () => {
  it('parses plain seconds', () => {
    expect(parseTime('12.5', ctx)).toBeCloseTo(12.5);
    expect(parseTime(12.5, ctx)).toBeCloseTo(12.5);
  });

  it('parses M:SS', () => {
    expect(parseTime('1:23', ctx)).toBeCloseTo(83);
  });

  it('parses H:MM:SS.mmm', () => {
    expect(parseTime('00:01:23.400', ctx)).toBeCloseTo(83.4);
  });

  it('parses relative offsets against currentTime', () => {
    expect(parseTime('+5', ctx)).toBeCloseTo(15);
    expect(parseTime('-2', ctx)).toBeCloseTo(8);
  });

  it('parses percent of duration', () => {
    expect(parseTime('50%', ctx)).toBeCloseTo(50);
  });

  it('parses frame numbers using ctx.fps', () => {
    expect(parseTime('f30', ctx)).toBeCloseTo(1);
    expect(parseTime('f45', ctx)).toBeCloseTo(1.5);
  });

  it('returns null for invalid input', () => {
    expect(parseTime('not-a-time', ctx)).toBeNull();
    expect(parseTime('', ctx)).toBeNull();
  });

  it('returns null for a frame number when fps is unknown', () => {
    expect(parseTime('f30', { duration: 100, currentTime: 10 })).toBeNull();
  });

  it('clamps negative relative offsets at zero, not below', () => {
    expect(parseTime('-100', ctx)).toBe(0);
  });
});

describe('formatTime', () => {
  it('formats seconds as HH:MM:SS.mmm', () => {
    expect(formatTime(83.4)).toBe('00:01:23.400');
    expect(formatTime(3661.05)).toBe('01:01:01.050');
    expect(formatTime(0)).toBe('00:00:00.000');
  });
});

describe('secsToTimecode', () => {
  it('formats seconds as MM:SS.mmm, dropping the hours component', () => {
    expect(secsToTimecode(83.4)).toBe('01:23.400');
    expect(secsToTimecode(3661.05)).toBe('61:01.050');
  });
});

describe('frameToTime', () => {
  it('converts a frame number to seconds at the given fps', () => {
    expect(frameToTime(30, 30)).toBeCloseTo(1);
    expect(frameToTime(45, 30)).toBeCloseTo(1.5);
    expect(frameToTime(0, 30)).toBe(0);
  });
});
