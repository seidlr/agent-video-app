import { describe, expect, it } from 'vitest';
import { currentLocalWhens } from '../../src/agent/webmcp';

describe('currentLocalWhens', () => {
  it('returns nothing when no source is loaded', () => {
    expect(currentLocalWhens(undefined)).toEqual([]);
  });

  it('returns only the yt-safe subset for a YouTube source', () => {
    expect(currentLocalWhens('youtube')).toEqual(['yt']);
  });

  it('returns local and yt for a fully decodable source (sample/url/file)', () => {
    expect(currentLocalWhens('sample')).toEqual(['local', 'yt']);
    expect(currentLocalWhens('url')).toEqual(['local', 'yt']);
    expect(currentLocalWhens('file')).toEqual(['local', 'yt']);
  });
});
