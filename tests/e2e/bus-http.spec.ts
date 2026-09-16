import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// A distinct port from server/stdio.ts's own 3333 default, so this test never collides with a
// developer's own `npm run mcp:stdio` (or `mcp:dev`) already running locally.
const BUS_PORT = '3399';
const BUS_URL = `http://localhost:${BUS_PORT}`;

async function waitForBusUp(): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const res = await fetch(`${BUS_URL}/bus/poll`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instanceId: 'readiness-probe' }),
      });
      if (res.ok || res.status === 400) return; // any real HTTP response means the listener is up
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error('server/stdio.ts bus HTTP listener never came up');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function studioSourceKind(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as unknown as { __studioStore?: { getState(): { source?: { kind?: string } | null } } }).__studioStore?.getState().source?.kind ?? null);
}

/** `toCallToolResult` (server/index.ts) always wraps a dispatched tool's own `{ok,...}` result
 * into a plain text content block -- it never sets the MCP-protocol `isError` flag for a business-
 * logic failure like `ui_not_connected`, only for a real server-side exception -- so the actual
 * ok/error status has to be parsed back out of that JSON text. */
function parseToolJson(result: Awaited<ReturnType<Client['callTool']>>): { ok: boolean; [key: string]: unknown } {
  const block = result.content?.[0] as { type: string; text?: string } | undefined;
  return JSON.parse(block?.text ?? '{}') as { ok: boolean };
}

/**
 * TS-011 steps 3-4 / the plan's own DoD for this file: a plain MCP client (standing in for Codex
 * CLI, which has no MCP App rendering) drives the studio through a REAL spawned `server/stdio.ts`
 * process and its HTTP bus, dispatching to a REAL browser tab opened with `?bus=<BUS_URL>` --
 * not the in-memory-transport server.test.ts, which never exercises bus-http.ts's actual HTTP
 * routes or a real browser tab's own busClient.ts poll loop.
 */
test.describe('HTTP bus (Codex CLI-style: a plain MCP client + a plain browser tab)', () => {
  let client: Client;

  test.beforeAll(async () => {
    // StdioClientTransport spawns and owns the child process itself; client.close() (afterAll)
    // tears it down too, so there is no separate process handle to track here.
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', 'server/stdio.ts'],
      env: { ...(process.env as Record<string, string>), BUS_PORT },
    });
    client = new Client({ name: 'bus-http-spec', version: '0.0.1' });
    await client.connect(transport);
    await waitForBusUp();
  });

  test.afterAll(async () => {
    await client?.close();
  });

  test('seek and capture_frame dispatch through the bus to a real browser tab, including an image content block', async ({ page }) => {
    test.setTimeout(90_000);

    await page.goto(`/?bus=${encodeURIComponent(BUS_URL)}`);

    // No render tool in this mode (per server/README.md: do not call open_video_studio here) --
    // load_video dispatches straight to the browser tab's own registry, same as every other tool.
    // busClient.ts's own registration is async and races this call (a real, previously-found bug
    // -- see the plan's own Deviations entry -- fixed on the client side, but the very first
    // dispatch here can still land before that tab has registered+polled even once), so retry
    // rather than assume the first attempt lands on an already-connected instance.
    await expect
      .poll(async () => parseToolJson(await client.callTool({ name: 'load_video', arguments: { source: 'sample', id: 'sprite-fight' } })), { timeout: 20_000 })
      .toMatchObject({ ok: true });
    await expect.poll(() => studioSourceKind(page), { timeout: 15_000 }).toBe('sample');

    const seekResult = parseToolJson(await client.callTool({ name: 'seek', arguments: { time: '2' } }));
    expect(seekResult).toMatchObject({ ok: true });
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __studioStore: { getState(): { player: { currentTime: number } } } }).__studioStore.getState().player.currentTime), { timeout: 15_000 })
      .toBeCloseTo(2, 0);

    const captureResult = await client.callTool({ name: 'capture_frame', arguments: { time: '2' } });
    expect(parseToolJson(captureResult)).toMatchObject({ ok: true });
    const imageBlock = (captureResult.content as { type: string }[] | undefined)?.find((c) => c.type === 'image') as { type: 'image'; data: string; mimeType: string } | undefined;
    expect(imageBlock).toBeDefined();
    expect(imageBlock!.mimeType).toBe('image/png');
    expect(imageBlock!.data.length).toBeGreaterThan(1000);
  });
});
