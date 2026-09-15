import { MODEL_CATALOG } from '../src/ml/catalog.js';

/**
 * The MCP App resource's `_meta.ui.csp`/`resourceDomains`/`frameDomains` (Task 11 Key Decisions):
 * every external origin the rendered iframe legitimately needs, so the host's sandbox doesn't
 * silently break a real feature. `catalog.ts` only carries HF-hosted entries today (import type-only
 * in that file -- no runtime dependency), so `catalogModelDomains()` mechanically extracts each
 * entry's own origin rather than repeating a hardcoded HF domain by hand; a future catalog entry
 * pointing elsewhere is picked up automatically instead of silently missing from the CSP.
 */

/** Hugging Face serves model *weights* (as opposed to the repo page in `catalog.ts`'s own `url`
 * field) from its LFS/CDN domains, not from `huggingface.co` itself -- these can't be derived from
 * `catalog.ts` data, since no catalog entry's `url` ever points at them directly. */
const HF_DOWNLOAD_CDN_DOMAINS = ['https://cdn-lfs.hf.co', 'https://*.hf.co'];

/** MediaPipe Tasks Vision's WASM runtime + task bundles (`detect_faces`/`detect_pose`, Task 8) --
 * not in `ml/catalog.ts` at all (that Task's own Deviations entry: MediaPipe manages its own
 * cache, outside the shared ModelRegistry/catalog system), so these stay a separate constant. */
const MEDIAPIPE_DOMAINS = ['https://cdn.jsdelivr.net', 'https://storage.googleapis.com'];

/** Sample videos (Task 2) and YouTube playback (Task 3). */
const VIDEO_SOURCE_DOMAINS = ['https://files.vidstack.io', 'https://www.youtube.com', 'https://i.ytimg.com'];

function catalogModelDomains(): string[] {
  const origins = new Set<string>();
  for (const entry of MODEL_CATALOG) origins.add(new URL(entry.url).origin);
  return [...origins];
}

export function connectDomains(): string[] {
  return [...catalogModelDomains(), ...HF_DOWNLOAD_CDN_DOMAINS, ...MEDIAPIPE_DOMAINS, ...VIDEO_SOURCE_DOMAINS];
}

export function resourceDomains(): string[] {
  return [...connectDomains(), 'https://fonts.gstatic.com'];
}

export const FRAME_DOMAINS = ['https://www.youtube-nocookie.com'];
