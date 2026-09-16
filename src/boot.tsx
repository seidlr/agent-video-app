import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { mountAgent } from './agent';
import { App } from './App';
import { DEFAULT_PROJECT_ID } from './lib/types';
import { restoreLastSourceOnBoot } from './media/load';
import { restoreFrames } from './store/frames';
import { restoreProjectData, wireProjectPersistence } from './store/projectPersistence';
import { studioStore } from './store/studio';
import { getPersistedTranscript } from './store/transcript';

/**
 * Shared boot sequence for both real entry points: `main.tsx` (the standalone site, `index.html`)
 * and `mcp-app.tsx` (the single-file MCP App bundle, `mcp-app.html`, Task 11) -- `mountAgent`
 * itself already detects the MCP App context (`isMcpAppContext()`) and switches transports
 * accordingly, so the two entry points need no behavioral fork today; they exist separately only
 * because Vite ties each HTML entry to its own script module.
 */
export function bootStudio(rootElementId = 'root'): void {
  if (import.meta.env.DEV) {
    (window as unknown as { __studioStore: typeof studioStore }).__studioStore = studioStore;
  }

  const rootEl = document.getElementById(rootElementId);
  if (!rootEl) {
    throw new Error(`Missing #${rootElementId} element`);
  }

  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // Restore the last-loaded video across a full page reload without the user re-selecting it
  // (Task 3 DoD). Best-effort: a stale/deleted asset or an unreachable URL must not block boot --
  // the app just falls back to the empty "no video loaded" state, same as a first-ever visit.
  // restoreLastSourceOnBoot itself guards against clobbering a source an agent already loaded
  // while this read was still in flight (see its own doc comment).
  const sourceRestored = restoreLastSourceOnBoot(studioStore, DEFAULT_PROJECT_ID);

  // Restore notes/chapters/boxes/tracks/clips and the Frames tray from Dexie (Task 9's own
  // reload-persistence pass -- see store/projectPersistence.ts's own doc comment for why this was a
  // pre-existing gap against the plan's top-level Verification bullet #2). Runs independently of
  // the source restore above: this data is asset-agnostic (the app is a single-project studio), so
  // there is nothing to wait on. `wireProjectPersistence` is armed only *after* the restore
  // resolves, so the restore's own setX calls don't trigger a redundant (if harmless) write-back.
  void Promise.all([restoreProjectData(studioStore), restoreFrames(studioStore)]).then(() => {
    wireProjectPersistence(studioStore);
  });

  // The transcript is keyed by assetId (Task 8), unlike the asset-agnostic slices above, so it can
  // only be restored once the source restore above resolves an asset. Best-effort, same tolerance.
  void sourceRestored.then(() => {
    const assetId = studioStore.getState().source?.assetId;
    if (!assetId) return;
    return getPersistedTranscript(assetId, null)
      .then((segments) => {
        if (segments && segments.length > 0) studioStore.getState().setTranscript(segments, null);
      })
      .catch(() => undefined);
  });

  // Mount the agent surface (WebMCP/bridge/MCP App/bus transports, session/library/playback
  // tools) after the store exists (Task 4). Independent of the source-restore above -- an agent
  // should be able to call load_video itself even before/without a prior session's video
  // finishing its restore.
  void mountAgent(studioStore);
}
