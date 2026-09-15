import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { mountAgent } from './agent';
import { App } from './App';
import { DEFAULT_PROJECT_ID } from './lib/types';
import { loadSource } from './media/load';
import { getLastSource } from './store/library';
import { studioStore } from './store/studio';
import './styles/index.css';

if (import.meta.env.DEV) {
  (window as unknown as { __studioStore: typeof studioStore }).__studioStore = studioStore;
}

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Missing #root element');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Restore the last-loaded video across a full page reload without the user re-selecting it
// (Task 3 DoD). Best-effort: a stale/deleted asset or an unreachable URL must not block boot --
// the app just falls back to the empty "no video loaded" state, same as a first-ever visit.
void getLastSource(DEFAULT_PROJECT_ID).then((lastSource) => {
  if (!lastSource) return;
  return loadSource(studioStore.getState(), lastSource).catch(() => undefined);
});

// Mount the agent surface (WebMCP/bridge transports, session/library/playback tools) after the
// store exists (Task 4). Independent of the source-restore above -- an agent should be able to
// call load_video itself even before/without a prior session's video finishing its restore.
void mountAgent(studioStore);
