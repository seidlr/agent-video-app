import type { StudioStore } from '../store/studio';
import { createActivityDeps } from './activity';
import { mountBridge } from './bridge';
import { createRegistry, type Registry } from './registry';
import { defineBoxesTools } from './tools/boxes';
import { defineChaptersTools } from './tools/chapters';
import { defineExportsTools } from './tools/exports';
import { defineFramesTools } from './tools/frames';
import { defineLibraryTools } from './tools/library';
import { defineNotesTools } from './tools/notes';
import { definePlaybackTools } from './tools/playback';
import { defineSessionTools } from './tools/session';
import { mountWebMcp } from './webmcp';

/**
 * Builds the registry and defines every tool this app owns so far (session/library/playback from
 * Task 4, frames from Task 5, notes/chapters/boxes/export_notes from Task 6; later tasks add
 * their own groups by calling their own `defineXTools(registry, store)` the same way). Split from
 * `mountAgent` so tests can build a registry without touching `window`/`document`.
 */
export function createAgentRegistry(store: StudioStore): Registry {
  const registry = createRegistry(createActivityDeps(store));
  defineSessionTools(registry, store);
  defineLibraryTools(registry, store);
  definePlaybackTools(registry, store);
  defineFramesTools(registry, store);
  defineNotesTools(registry, store);
  defineChaptersTools(registry, store);
  defineBoxesTools(registry, store);
  defineExportsTools(registry, store);
  return registry;
}

/**
 * Wires the full agent surface onto the page: builds the registry, mounts the WebMCP transport
 * (native or the `@mcp-b/global` polyfill/bridge, which also installs `navigator.modelContextTesting`),
 * mounts `window.agentVideo` for scripting-driven agents, and records the detected transport back
 * into the store so the TopBar pill and `get_state` report it. Called once from main.tsx after
 * the store exists.
 */
export async function mountAgent(store: StudioStore): Promise<Registry> {
  const registry = createAgentRegistry(store);
  mountBridge(registry);
  const transport = await mountWebMcp(registry, store);
  store.getState().setAgentTransport(transport);
  return registry;
}
