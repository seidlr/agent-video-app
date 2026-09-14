import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseYouTubeId, ytimgThumbnailUrls, fetchYouTubeOEmbed } from '../../src/media/youtube';

describe('parseYouTubeId', () => {
  it('parses youtu.be short links', () => {
    expect(parseYouTubeId('https://youtu.be/_cMxraX_5RE')).toBe('_cMxraX_5RE');
  });

  it('parses youtube.com/watch?v= links, ignoring extra query params', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?v=_cMxraX_5RE&t=30s')).toBe('_cMxraX_5RE');
  });

  it('parses youtube.com/embed/ links', () => {
    expect(parseYouTubeId('https://www.youtube.com/embed/_cMxraX_5RE')).toBe('_cMxraX_5RE');
  });

  it('accepts a bare 11-character id', () => {
    expect(parseYouTubeId('_cMxraX_5RE')).toBe('_cMxraX_5RE');
  });

  it('returns null for a non-YouTube URL', () => {
    expect(parseYouTubeId('https://example.com/video.mp4')).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(parseYouTubeId('not a url at all')).toBeNull();
  });
});

describe('ytimgThumbnailUrls', () => {
  it('returns the four still-frame thumbnail URLs for a video id', () => {
    expect(ytimgThumbnailUrls('_cMxraX_5RE')).toEqual([
      'https://i.ytimg.com/vi/_cMxraX_5RE/0.jpg',
      'https://i.ytimg.com/vi/_cMxraX_5RE/1.jpg',
      'https://i.ytimg.com/vi/_cMxraX_5RE/2.jpg',
      'https://i.ytimg.com/vi/_cMxraX_5RE/3.jpg',
    ]);
  });
});

describe('fetchYouTubeOEmbed', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns title/author/thumbnail from the oEmbed endpoint', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          title: 'A great video',
          author_name: 'Someone',
          thumbnail_url: 'https://i.ytimg.com/vi/_cMxraX_5RE/hqdefault.jpg',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchYouTubeOEmbed('_cMxraX_5RE');
    expect(result).toEqual({
      title: 'A great video',
      author: 'Someone',
      thumbnailUrl: 'https://i.ytimg.com/vi/_cMxraX_5RE/hqdefault.jpg',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://www.youtube.com/oembed?url='),
    );
  });

  it('returns null without throwing when oEmbed fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 })),
    );
    expect(await fetchYouTubeOEmbed('_cMxraX_5RE')).toBeNull();
  });
});
