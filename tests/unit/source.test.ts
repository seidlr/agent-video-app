import { describe, expect, it, vi } from 'vitest';
import { resolveSource, type SourceDeps } from '../../src/media/source';

const baseDeps: SourceDeps = {
  fetchSamples: vi.fn(async () => ({
    samples: [
      {
        id: 'sprite-fight',
        title: 'Sprite Fight',
        url: 'https://files.vidstack.io/sprite-fight/720p.mp4',
        thumbnailsVtt: 'https://files.vidstack.io/sprite-fight/thumbnails.vtt',
        duration: 629,
        width: 1280,
        height: 720,
        license: 'demo',
      },
    ],
  })),
  probeCors: vi.fn(async () => true),
  fetchOEmbed: vi.fn(async () => ({ title: 'A great video', author: 'Someone', thumbnailUrl: 'https://i.ytimg.com/vi/_cMxraX_5RE/hqdefault.jpg' })),
  readLibraryFile: vi.fn(async () => new File([new Uint8Array(4)], 'clip.mp4', { type: 'video/mp4' })),
  createObjectUrl: vi.fn(() => 'blob:mock-url'),
};

describe('resolveSource', () => {
  it('resolves the sample source by id, including its thumbnails VTT', async () => {
    const result = await resolveSource({ kind: 'sample', id: 'sprite-fight' }, baseDeps);
    expect(result).toEqual({
      src: 'https://files.vidstack.io/sprite-fight/720p.mp4',
      title: 'Sprite Fight',
      kind: 'sample',
      thumbnailsVttUrl: 'https://files.vidstack.io/sprite-fight/thumbnails.vtt',
      canCapture: true,
    });
  });

  it('throws a descriptive error for an unknown sample id', async () => {
    await expect(resolveSource({ kind: 'sample', id: 'nope' }, baseDeps)).rejects.toThrow(/unknown_sample/);
  });

  it('resolves a URL source and probes CORS to set canCapture', async () => {
    const result = await resolveSource({ kind: 'url', url: 'https://example.com/clip.mp4' }, baseDeps);
    expect(result.src).toBe('https://example.com/clip.mp4');
    expect(result.kind).toBe('url');
    expect(result.canCapture).toBe(true);
    expect(baseDeps.probeCors).toHaveBeenCalledWith('https://example.com/clip.mp4');
  });

  it('sets canCapture false for a URL source that fails the CORS probe', async () => {
    const deps = { ...baseDeps, probeCors: vi.fn(async () => false) };
    const result = await resolveSource({ kind: 'url', url: 'https://example.com/clip.mp4' }, deps);
    expect(result.canCapture).toBe(false);
  });

  it('resolves a YouTube source via oEmbed, with the 4 ytimg thumbs as a degraded filmstrip, always canCapture false', async () => {
    const result = await resolveSource({ kind: 'youtube', url: 'https://youtu.be/_cMxraX_5RE' }, baseDeps);
    expect(result).toEqual({
      src: 'youtube/_cMxraX_5RE',
      title: 'A great video',
      poster: 'https://i.ytimg.com/vi/_cMxraX_5RE/hqdefault.jpg',
      filmstripUrls: [
        'https://i.ytimg.com/vi/_cMxraX_5RE/0.jpg',
        'https://i.ytimg.com/vi/_cMxraX_5RE/1.jpg',
        'https://i.ytimg.com/vi/_cMxraX_5RE/2.jpg',
        'https://i.ytimg.com/vi/_cMxraX_5RE/3.jpg',
      ],
      kind: 'youtube',
      canCapture: false,
    });
  });

  it('falls back to a generic title when oEmbed fails', async () => {
    const deps = { ...baseDeps, fetchOEmbed: vi.fn(async () => null) };
    const result = await resolveSource({ kind: 'youtube', url: 'https://youtu.be/_cMxraX_5RE' }, deps);
    expect(result.title).toBe('YouTube video');
    expect(result.poster).toBeUndefined();
  });

  it('throws for a YouTube url it cannot parse an id from', async () => {
    await expect(resolveSource({ kind: 'youtube', url: 'not-a-youtube-url' }, baseDeps)).rejects.toThrow(
      /invalid_youtube_url/,
    );
  });

  it('resolves a library (file) source into a blob URL via readLibraryFile, with an explicit mimeType', async () => {
    const result = await resolveSource({ kind: 'file', id: 'asset-1' }, baseDeps);
    expect(result.kind).toBe('file');
    expect(result.canCapture).toBe(true);
    expect(result.src).toBe('blob:mock-url');
    expect(result.assetId).toBe('asset-1');
    // blob: URLs have no file extension for vidstack to sniff a provider from, and its HEAD-based
    // fallback probe 404s against blob: URLs in Chromium -- an explicit type is required so it
    // never needs that fallback (see VideoStage.tsx, which reads this field).
    expect(result.mimeType).toBe('video/mp4');
    expect(baseDeps.readLibraryFile).toHaveBeenCalledWith('asset-1');
  });
});
