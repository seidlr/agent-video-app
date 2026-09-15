import type { AgentTransport, StudioStore } from '../store/studio';
import type { Registry } from './registry';

const POLL_ERROR_BACKOFF_MS = 1000;
const RETIRED_RETRY_MS = 500;

/** `?bus=<origin>` (Key Decisions): a UI-less MCP client like Codex CLI has no way to render an
 * iframe, so a normal browser tab of the site is opened separately and points itself at that
 * client's own HTTP bus listener (`server/stdio.ts`'s `BUS_PORT`) to act as its UI instance. */
export function getBusUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = new URLSearchParams(window.location.search).get('bus');
  return raw || undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface DataUrlParts {
  base64: string;
  mimeType: string;
}

/** Same check as `mcpApp.ts`'s own -- see its doc comment for why this stays a generic
 * string-shape check rather than special-casing `capture_frame` by name. */
function extractDataUrl(value: unknown): DataUrlParts | undefined {
  if (typeof value !== 'string' || !value.startsWith('data:')) return undefined;
  const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(value);
  if (!match) return undefined;
  return { mimeType: match[1]!, base64: match[2]! };
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * The HTTP-bus twin of `mcpApp.ts` (Task 11 Key Decisions: "the same client logic as `mcpApp.ts`
 * with `fetch` instead of `callServerTool`"): registers this tab as `busUrl`'s UI instance, then
 * polls `/bus/poll` (a real long-poll server-side -- see `server/bus.ts`'s `longPollCommands`) and
 * dispatches every command through the same `registry.call` every other transport uses.
 */
export async function mountBusClient(registry: Registry, store: StudioStore, busUrl: string): Promise<AgentTransport> {
  const instanceId = crypto.randomUUID();
  // Tracks whether registration has ever actually succeeded -- confirmed live (a real browser tab
  // against a real spawned server) that the page can load *before* a locally-run MCP server has
  // finished starting up (a real race: nothing orders "open the site" against "start codex mcp"),
  // and a single unretried registration attempt then permanently strands the tab as an unknown
  // instance forever, even once the server comes up seconds later -- every poll just gets
  // {retired:true} back (a truly-unknown instanceId reads identically to "superseded by a newer
  // registration" over the wire), so retrying only *before* the first real success can't be
  // skipped without silently losing the whole session for anyone who loads the page first.
  let registered = false;

  async function register(): Promise<void> {
    const result = await postJson(`${busUrl}/bus/register`, { instanceId });
    if (result?.ok) registered = true;
  }

  await register();
  store.getState().setAgentTransport('mcp-bus');

  void (async function pollLoop(): Promise<void> {
    for (;;) {
      if (!registered) {
        await register();
        if (!registered) {
          await sleep(POLL_ERROR_BACKOFF_MS);
          continue;
        }
      }
      const polled = await postJson(`${busUrl}/bus/poll`, { instanceId });
      if (!polled) {
        await sleep(POLL_ERROR_BACKOFF_MS);
        continue;
      }
      if (polled.retired) {
        // Only reachable once `registered` is already true, so this is a *genuine* hand-off (a
        // different instanceId registered for the same session -- e.g. a second tab) rather than
        // this tab never having registered at all. This tab has no way to reclaim focus on its
        // own (there is no render tool to call from a UI-less client's own browser tab), so just
        // wait; a human re-registering elsewhere is the only way back.
        await sleep(RETIRED_RETRY_MS);
        continue;
      }
      const command = polled.command as { cmdId: string; name: string; args: Record<string, unknown> } | null;
      if (!command) continue;

      const toolArgs = command.name === 'capture_frame' && command.args.includeDataUrl === undefined ? { ...command.args, includeDataUrl: true } : command.args;
      const toolResult = (await registry.call(command.name, toolArgs, { via: 'mcp-bus' })) as Record<string, unknown>;
      const image = extractDataUrl(toolResult.dataUrl);
      const resultWithoutDataUrl = { ...toolResult };
      delete resultWithoutDataUrl.dataUrl;
      await postJson(`${busUrl}/bus/result`, {
        instanceId,
        cmdId: command.cmdId,
        result: resultWithoutDataUrl,
        ...(image ? { imageBase64: image.base64, mimeType: image.mimeType } : {}),
      });
    }
  })();

  return 'mcp-bus';
}
