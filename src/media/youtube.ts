/**
 * YouTube support without a backend: id parsing, the CORS-clean oEmbed endpoint for
 * title/author/poster, and the four "storyboard" still frames at i.ytimg.com as a degraded
 * filmstrip. Actual frame pixels are unreachable (cross-origin iframe) — see Task 5.
 */

const ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (ID_PATTERN.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return id && ID_PATTERN.test(id) ? id : null;
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') {
      const id = url.searchParams.get('v');
      return id && ID_PATTERN.test(id) ? id : null;
    }
    const embedMatch = /^\/embed\/([A-Za-z0-9_-]{11})/.exec(url.pathname);
    if (embedMatch?.[1]) return embedMatch[1];
    const shortsMatch = /^\/shorts\/([A-Za-z0-9_-]{11})/.exec(url.pathname);
    if (shortsMatch?.[1]) return shortsMatch[1];
  }
  return null;
}

/** The 4 CORS-clean (`Access-Control-Allow-Origin: *`) still frames — a poor-man's filmstrip. */
export function ytimgThumbnailUrls(videoId: string): string[] {
  return [0, 1, 2, 3].map((i) => `https://i.ytimg.com/vi/${videoId}/${i}.jpg`);
}

export interface YouTubeOEmbed {
  title: string;
  author: string | null;
  thumbnailUrl: string | null;
}

/** CORS-clean, no API key, no quota. Returns null (never throws) if the video is unavailable. */
export async function fetchYouTubeOEmbed(videoId: string): Promise<YouTubeOEmbed | null> {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
  try {
    const res = await fetch(endpoint);
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
    if (!data.title) return null;
    return {
      title: data.title,
      author: data.author_name ?? null,
      thumbnailUrl: data.thumbnail_url ?? null,
    };
  } catch {
    return null;
  }
}
