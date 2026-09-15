import { ALL_FORMATS, BlobSource, Input, UrlSource } from 'mediabunny';
import { readLibraryFile } from '../store/library';
import type { ResolvedSource } from './source';

/**
 * Caches one mediabunny `Input` per loaded source (keyed by assetId for local files, by URL
 * otherwise) so repeated frame captures/thumbnail generation don't re-open and re-probe the same
 * media. YouTube has no `Input` -- there is no direct byte/pixel access across the iframe -- so
 * callers must branch on `source.kind === 'youtube'` before calling this.
 */
const cache = new Map<string, Input>();

function cacheKey(source: ResolvedSource): string {
  return source.assetId ?? source.src;
}

export async function getInput(source: ResolvedSource): Promise<Input> {
  if (source.kind === 'youtube') {
    throw new Error('youtube_pixels_unavailable: no direct pixel/byte access across the YouTube iframe');
  }

  const key = cacheKey(source);
  const cached = cache.get(key);
  if (cached) return cached;

  const mediabunnySource =
    source.kind === 'file' && source.assetId ? new BlobSource(await readLibraryFile(source.assetId)) : new UrlSource(source.src);
  const input = new Input({ source: mediabunnySource, formats: ALL_FORMATS });
  cache.set(key, input);
  return input;
}

/** Drops every cached Input (and, with it, mediabunny's internal packet/decoder state). Called
 * when an asset is removed from the library so a stale Input can't outlive its bytes. */
export function clearInputCache(key?: string): void {
  if (key === undefined) {
    cache.clear();
    return;
  }
  cache.delete(key);
}
