import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import type { McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { AgentTransport, StudioStore } from '../store/studio';
import type { Registry } from './registry';

const CONTEXT_UPDATE_DEBOUNCE_MS = 1000;
const POLL_ERROR_BACKOFF_MS = 1000;
const RETIRED_RETRY_MS = 500;

/** Detection per the plan's own Key Decisions: a sandboxed MCP App iframe has an opaque origin
 * (`window.location.origin === 'null'`); `?mcp=1` covers a host that renders the same bundle in a
 * normal (non-opaque-origin) frame. */
export function isMcpAppContext(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.location.origin === 'null') return true;
  return new URLSearchParams(window.location.search).get('mcp') === '1';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface DataUrlParts {
  base64: string;
  mimeType: string;
}

/** `capture_frame`'s own `dataUrl` field (`data:<mime>;base64,<data>`) is the only image-bearing
 * field any tool returns today (checked: no other tool in `agent/tools/*.ts` produces one) -- a
 * generic string-shaped check here, rather than hardcoding `capture_frame`, means a future
 * image-producing tool needs no change on this side to hand its image back correctly. */
function extractDataUrl(value: unknown): DataUrlParts | undefined {
  if (typeof value !== 'string' || !value.startsWith('data:')) return undefined;
  const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(value);
  if (!match) return undefined;
  return { mimeType: match[1]!, base64: match[2]! };
}

function applyHostContext(ctx: McpUiHostContext): void {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

/**
 * Mounts the studio as an MCP App View (Task 11): connects to the host via `App`, renders
 * `open_video_studio`'s own `structuredContent` (instanceId + the initial `load_video` args) once
 * it arrives, applies host theming, and runs a poll loop over `app.callServerTool('poll_commands')`
 * -- each command dispatches through the SAME registry every other transport uses
 * (`registry.call(name, args, {via:'mcp-app'})`), and its result (image data pulled out of a
 * `dataUrl` field, if any, into `post_result`'s own `imageBase64`/`mimeType` fields per the plan's
 * Key Decisions) posts back to the server. Runs for the App's entire lifetime; `onteardown`
 * retires the instance and lets the poll loop's own `stopped` flag end it.
 */
export async function mountMcpApp(registry: Registry, store: StudioStore): Promise<AgentTransport> {
  const app = new App({ name: 'agent-video-studio', version: '0.1.0' });

  let instanceId: string | undefined;
  let stopped = false;
  let contextTimer: ReturnType<typeof setTimeout> | undefined;

  async function pushModelContext(): Promise<void> {
    const state = (await registry.call('get_state', {})) as { summary?: string };
    await app.updateModelContext({ content: [{ type: 'text', text: state.summary ?? 'No video loaded.' }] }).catch(() => undefined);
  }

  function scheduleContextUpdate(): void {
    if (contextTimer) clearTimeout(contextTimer);
    contextTimer = setTimeout(() => void pushModelContext(), CONTEXT_UPDATE_DEBOUNCE_MS);
  }

  app.onhostcontextchanged = (ctx) => applyHostContext(ctx);

  app.ontoolresult = (result) => {
    const structured = result.structuredContent as { instanceId?: string; load?: Record<string, unknown> } | undefined;
    if (!structured?.instanceId) return;
    instanceId = structured.instanceId;
    if (structured.load && Object.keys(structured.load).length > 0) {
      void registry.call('load_video', structured.load, { via: 'mcp-app' });
    }
  };

  app.onteardown = async () => {
    stopped = true;
    if (instanceId) await app.callServerTool({ name: 'retire_instance', arguments: { instanceId } }).catch(() => undefined);
    return {};
  };

  await app.connect();
  const initialContext = app.getHostContext();
  if (initialContext) applyHostContext(initialContext);

  store.getState().setAgentTransport('mcp-app');
  store.subscribe(() => scheduleContextUpdate());
  scheduleContextUpdate();

  void (async function pollLoop(): Promise<void> {
    while (!stopped) {
      if (!instanceId) {
        await sleep(RETIRED_RETRY_MS);
        continue;
      }
      let polled: { retired?: boolean; command: { cmdId: string; name: string; args: Record<string, unknown> } | null } | undefined;
      try {
        const result = await app.callServerTool({ name: 'poll_commands', arguments: { instanceId } });
        polled = result.structuredContent as typeof polled;
      } catch {
        await sleep(POLL_ERROR_BACKOFF_MS);
        continue;
      }
      if (!polled) continue;
      if (polled.retired) {
        instanceId = undefined;
        continue;
      }
      if (!polled.command) continue;

      const { cmdId, name, args } = polled.command;
      const toolArgs = name === 'capture_frame' && args.includeDataUrl === undefined ? { ...args, includeDataUrl: true } : args;
      const toolResult = (await registry.call(name, toolArgs, { via: 'mcp-app' })) as Record<string, unknown>;
      const image = extractDataUrl(toolResult.dataUrl);
      const resultWithoutDataUrl = { ...toolResult };
      delete resultWithoutDataUrl.dataUrl;
      await app
        .callServerTool({
          name: 'post_result',
          arguments: { instanceId, cmdId, result: resultWithoutDataUrl, ...(image ? { imageBase64: image.base64, mimeType: image.mimeType } : {}) },
        })
        .catch(() => undefined);
      scheduleContextUpdate();
    }
  })();

  return 'mcp-app';
}
