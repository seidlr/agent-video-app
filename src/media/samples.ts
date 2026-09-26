import type { SampleCatalogEntry } from './source';

/**
 * The sample videos any surface can load. Bundled into the code rather than fetched from
 * `samples/index.json` at runtime: the single-file MCP App has no directory to fetch from (inside a
 * host's sandboxed iframe, or served by the stdio server at http://localhost:<bus port>/), so a
 * runtime fetch there 404'd and `load_video {source:'sample'}` failed with
 * "failed_to_load_samples: HTTP 404" (confirmed live against the self-served page).
 */
export const SAMPLE_CATALOG: SampleCatalogEntry[] = [
  {
    id: 'sprite-fight',
    title: 'Sprite Fight',
    url: 'https://files.vidstack.io/sprite-fight/720p.mp4',
    thumbnailsVtt: 'https://files.vidstack.io/sprite-fight/thumbnails.vtt',
    duration: 629,
    width: 1280,
    height: 720,
    license: 'CORS-enabled demo asset, vidstack.io',
  },
];
