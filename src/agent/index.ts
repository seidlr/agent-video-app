import type { StudioStore } from '../store/studio';
import { createActivityDeps } from './activity';
import { mountBridge } from './bridge';
import { createRegistry, type Registry } from './registry';
import { defineLibraryTools } from './tools/library';
import { definePlaybackTools } from './tools/playback';
import { defineSessionTools } from './tools/session';
import { mountWebMcp } from './webmcp';

/**
 * Builds the registry and defines every tool Task 4 owns (session/library/playback; later tasks
 * add their own groups by calling their own `defineXTools(registry, store)` the same way). Split
 * from `mountAgent` so tests can build a registry without touching `window`/`document`.
 */
export function createAgentRegistry(store: StudioStore): Registry {
  const registry = createRegistry(createActivityDeps(store));
  defineSessionTools(registry, store);
  defineLibraryTools(registry, store);
  definePlaybackTools(registry, store);
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
