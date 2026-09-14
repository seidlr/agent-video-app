import type { AssetKind } from '../lib/types';
import { fetchYouTubeOEmbed, parseYouTubeId, ytimgThumbnailUrls } from './youtube';

export interface SampleCatalogEntry {
  id: string;
  title: string;
  url: string;
  thumbnailsVtt?: string;
  duration: number;
  width: number;
  height: number;
  license: string;
}

export interface SourceRequest {
  kind: AssetKind;
  id?: string;
  url?: string;
}

export interface ResolvedSource {
  src: string;
  title: string;
  poster?: string;
  kind: AssetKind;
  thumbnailsVttUrl?: string;
  /** Degraded filmstrip for YouTube (the 4 free CORS-clean i.ytimg.com still frames -- real
   * pixels are unreachable across the cross-origin iframe). Task 5 generates a real filmstrip
   * for local/URL sources via mediabunny instead of populating this field. */
  filmstripUrls?: string[];
  canCapture: boolean;
  /** Set only for kind:'file' -- the Dexie asset id, so metadata can be written back once the
   * player reports real duration/dimensions (see src/store/library.ts updateAssetMetadata). */
  assetId?: string;
  /** Set only for kind:'file'. A `blob:` URL has no file extension for vidstack's provider
   * loader to sniff a type from, and its HEAD-based fallback probe 404s against blob: URLs in
   * Chromium (confirmed empirically), leaving playback stuck at "media is not ready" forever --
   * VideoStage.tsx passes this through as the MediaPlayer src's explicit `type` so that fallback
   * is never needed. Sample/url/youtube sources already have a sniffable extension or vidstack's
   * built-in YouTube matcher, so they don't need this. */
  mimeType?: string;
}

export interface SourceDeps {
  fetchSamples(): Promise<{ samples: SampleCatalogEntry[] }>;
  probeCors(url: string): Promise<boolean>;
  fetchOEmbed(videoId: string): ReturnType<typeof fetchYouTubeOEmbed>;
  readLibraryFile(assetId: string): Promise<File>;
  createObjectUrl(file: File): string;
}

/** Default deps for production use; tests inject their own to stay hermetic. */
export function defaultSourceDeps(readLibraryFile: SourceDeps['readLibraryFile']): SourceDeps {
  return {
    async fetchSamples() {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/index.json`);
      if (!res.ok) throw new Error(`failed_to_load_samples: HTTP ${res.status}`);
      return res.json();
    },
    async probeCors(url) {
      try {
        const res = await fetch(url, { method: 'HEAD', mode: 'cors' });
        return res.ok;
      } catch {
        return false;
      }
    },
    fetchOEmbed: fetchYouTubeOEmbed,
    readLibraryFile,
    createObjectUrl: (file) => URL.createObjectURL(file),
  };
}

export async function resolveSource(request: SourceRequest, deps: SourceDeps): Promise<ResolvedSource> {
  switch (request.kind) {
    case 'sample': {
      const { samples } = await deps.fetchSamples();
      const sample = samples.find((s) => s.id === request.id);
      if (!sample) throw new Error(`unknown_sample: no sample with id "${request.id}"`);
      return {
        src: sample.url,
        title: sample.title,
        kind: 'sample',
        thumbnailsVttUrl: sample.thumbnailsVtt,
        canCapture: true,
      };
    }

    case 'url': {
      if (!request.url) throw new Error('missing_url: a url source requires "url"');
      const canCapture = await deps.probeCors(request.url);
      return {
        src: request.url,
        title: request.url.split('/').pop() || request.url,
        kind: 'url',
        canCapture,
      };
    }

    case 'youtube': {
      if (!request.url) throw new Error('missing_url: a youtube source requires "url"');
      const videoId = parseYouTubeId(request.url);
      if (!videoId) throw new Error(`invalid_youtube_url: could not parse a video id from "${request.url}"`);
      const oembed = await deps.fetchOEmbed(videoId);
      return {
        src: `youtube/${videoId}`,
        title: oembed?.title ?? 'YouTube video',
        poster: oembed?.thumbnailUrl ?? undefined,
        filmstripUrls: ytimgThumbnailUrls(videoId),
        kind: 'youtube',
        canCapture: false,
      };
    }

    case 'file':
    default: {
      if (!request.id) throw new Error('missing_id: a library source requires "id"');
      const file = await deps.readLibraryFile(request.id);
      return {
        src: deps.createObjectUrl(file),
        title: file.name,
        kind: 'file',
        canCapture: true,
        assetId: request.id,
        mimeType: file.type || undefined,
      };
    }
  }
}
