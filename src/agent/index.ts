import type { StudioStore } from '../store/studio';
import { createActivityDeps } from './activity';
import { mountBridge } from './bridge';
import { getBusUrl, mountBusClient } from './busClient';
import { isMcpAppContext, mountMcpApp } from './mcpApp';
import { createRegistry, type Registry } from './registry';
import { defineAudioTools } from './tools/audio';
import { defineBoxesTools } from './tools/boxes';
import { defineChaptersTools } from './tools/chapters';
import { defineClipsTools } from './tools/clips';
import { defineEffectsTools } from './tools/effects';
import { defineExportsTools } from './tools/exports';
import { defineFramesTools } from './tools/frames';
import { defineLibraryTools } from './tools/library';
import { defineModelTools } from './tools/models';
import { defineNotesTools } from './tools/notes';
import { definePlaybackTools } from './tools/playback';
import { defineSessionTools } from './tools/session';
import { defineTranscriptTools } from './tools/transcript';
import { defineVisionTools } from './tools/vision';
import { defineVlmTools } from './tools/vlm';
import { mountWebMcp } from './webmcp';

/**
 * Builds the registry and defines every tool this app owns so far (session/library/playback from
 * Task 4, frames from Task 5, notes/chapters/boxes/export_notes from Task 6, models/segment/track
 * from Task 7, detect_scenes/find_similar_frames/transcribe/get_transcript/search_transcript from
 * Task 8; later tasks add their own groups by calling their own `defineXTools(registry, store)`
 * the same way). Split from `mountAgent` so tests can build a registry without touching
 * `window`/`document`.
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
  defineClipsTools(registry, store);
  defineExportsTools(registry, store);
  defineModelTools(registry, store);
  defineVisionTools(registry, store);
  defineTranscriptTools(registry, store);
  defineAudioTools(registry, store);
  defineVlmTools(registry, store);
  defineEffectsTools(registry, store);
  return registry;
}

/**
 * Wires the full agent surface onto the page: builds the registry, then mounts exactly one of
 * three mutually exclusive connection modes (Task 11 Key Decisions) --
 *
 * 1. **MCP App** (`isMcpAppContext()`: a sandboxed iframe, or `?mcp=1`): rendered by an MCP host
 *    (Claude Desktop, ChatGPT Desktop, VS Code); connects via `App`/`postMessage`, no DOM-level
 *    WebMCP registration applies inside a sandboxed iframe.
 * 2. **HTTP bus** (`?bus=<origin>`): a UI-less MCP client like Codex CLI drives this same page over
 *    plain HTTP polling instead.
 * 3. **Default**: a normal browser tab -- mounts the WebMCP transport (native or the
 *    `@mcp-b/global` polyfill, which also installs `navigator.modelContextTesting`) and
 *    `window.agentVideo` for scripting-driven agents (Claude in Chrome).
 *
 * Records the resulting transport back into the store so the TopBar pill and `get_state` report
 * it. Called once from main.tsx after the store exists.
 */
export async function mountAgent(store: StudioStore): Promise<Registry> {
  const registry = createAgentRegistry(store);

  if (isMcpAppContext()) {
    const transport = await mountMcpApp(registry, store);
    store.getState().setAgentTransport(transport);
    return registry;
  }

  const busUrl = getBusUrl();
  if (busUrl) {
    mountBridge(registry);
    const transport = await mountBusClient(registry, store, busUrl);
    store.getState().setAgentTransport(transport);
    return registry;
  }

  mountBridge(registry);
  const transport = await mountWebMcp(registry, store);
  store.getState().setAgentTransport(transport);
  return registry;
}
