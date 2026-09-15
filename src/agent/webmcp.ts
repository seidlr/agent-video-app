import type { AgentTransport, StudioStore } from '../store/studio';
import type { Registry, ToolDefinition, ToolWhen } from './registry';

/** Which `when` groups should be registered given the currently loaded source: no source means
 * only `always` tools apply (handled by the caller separately); YouTube exposes only its
 * `yt`-safe subset of the local tool groups (no local decode access); any other loaded source
 * (sample/url/file) is fully local-capable. */
export function currentLocalWhens(sourceKind: string | undefined): ToolWhen[] {
  if (!sourceKind) return [];
  if (sourceKind === 'youtube') return ['yt'];
  return ['local', 'yt'];
}

/**
 * Two incompatible `document.modelContext` type surfaces are live at once here: this repo's own
 * `webmcp-types` dependency (Global Constraints; a 2-arg `execute(input, {signal})`) and
 * `@mcp-b/webmcp-types` (transitively pulled in by `import '@mcp-b/global'` below; a 1-arg
 * `execute(input)`). Both describe the same runtime call convention (extra JS arguments are
 * simply ignored), so the mismatch is a type-only artifact of two packages independently
 * augmenting the same global -- there is no single object literal TypeScript accepts against
 * both `registerTool` overload sets simultaneously. `registerToolLoosely` isolates the one
 * unavoidable `as never` this requires instead of scattering casts through the mount logic.
 */
function toWebMcpTool(tool: ToolDefinition, registry: Registry) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as object,
    annotations: tool.annotations,
    execute: (args: Record<string, unknown>) => registry.call(tool.name, args, { via: 'webmcp' }),
  };
}

function registerToolLoosely(
  modelContext: NonNullable<Document['modelContext']>,
  tool: ReturnType<typeof toWebMcpTool>,
  options: { signal: AbortSignal },
): Promise<void> {
  return modelContext.registerTool(tool as never, options);
}

/**
 * Mounts every `always` tool onto `document.modelContext` (native WebMCP, or the `@mcp-b/global`
 * polyfill/bridge when native support is absent) and keeps the `local`/`yt` subset in sync with
 * the loaded source: registered while a decodable local/URL/sample source is loaded, narrowed to
 * the YouTube-safe subset for a YouTube source, and unregistered entirely with nothing loaded.
 * `@mcp-b/global`'s own polyfill also installs `navigator.modelContextTesting` (Playwright/e2e
 * driving) and a cross-tab/extension transport -- one mount covers native, testing and bridge.
 */
export async function mountWebMcp(registry: Registry, store: StudioStore): Promise<AgentTransport> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 'none';

  const hadNativeContext = typeof document.modelContext !== 'undefined';

  (window as unknown as { __webModelContextOptions?: unknown }).__webModelContextOptions = {
    transport: { tabServer: { allowedOrigins: [window.location.origin] } },
  };
  await import('@mcp-b/global');

  const modelContext = document.modelContext;
  if (!modelContext) return 'none';

  const alwaysController = new AbortController();
  for (const tool of registry.list({ when: ['always'] })) {
    await registerToolLoosely(modelContext, toWebMcpTool(tool, registry), { signal: alwaysController.signal });
  }

  // Separate abort-controller lifecycles for the source-driven ('local'/'yt') batch and the
  // transcript-driven ('after-transcribe') batch. They must NOT share one controller: a job-mode
  // tool like `transcribe` (registered in the source batch) writes to `transcript` state as the
  // very last step of its own handler, before its call promise resolves back through the mcp-b
  // transport -- aborting the SAME controller `transcribe` is registered under at that moment
  // makes the polyfill reject the still-in-flight call with "Tool unregistered", even though the
  // handler already computed its result. Confirmed empirically: a single shared controller made
  // every `transcribe` call fail this way the instant it succeeded.
  let sourceController: AbortController | null = null;
  async function refreshSourceTools(): Promise<void> {
    sourceController?.abort();
    sourceController = new AbortController();
    const whens = currentLocalWhens(store.getState().source?.kind);
    if (whens.length === 0) return;
    for (const tool of registry.list({ when: whens })) {
      // Non-null: this closure only ever runs after the early `!modelContext` return above.
      await registerToolLoosely(modelContext!, toWebMcpTool(tool, registry), { signal: sourceController.signal });
    }
  }

  let transcriptController: AbortController | null = null;
  async function refreshTranscriptTools(): Promise<void> {
    transcriptController?.abort();
    transcriptController = new AbortController();
    if (store.getState().transcript.segments.length === 0) return;
    for (const tool of registry.list({ when: ['after-transcribe'] })) {
      await registerToolLoosely(modelContext!, toWebMcpTool(tool, registry), { signal: transcriptController.signal });
    }
  }

  await refreshSourceTools();
  await refreshTranscriptTools();
  store.subscribe((state, prevState) => {
    if (state.source?.kind !== prevState.source?.kind) void refreshSourceTools();
    const hadTranscript = prevState.transcript.segments.length > 0;
    const hasTranscript = state.transcript.segments.length > 0;
    if (hadTranscript !== hasTranscript) void refreshTranscriptTools();
  });

  return hadNativeContext ? 'webmcp' : 'bridge';
}
