import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { expect, test } from '@playwright/test';
import type { CallToolResult } from '@modelcontextprotocol/server';

const BUS_PORT = '3398';

/**
 * A host that can't render MCP Apps (reported live: a Claude Code session in Claude Desktop) calls
 * open_video_studio, but no studio ever mounts. The server hands back a page the agent can open in
 * any browser instead -- served by the stdio server itself on its bus port, so it needs no public
 * site, no CORS, and no Local Network Access permission (Chrome blocks a public https page from
 * reaching http://localhost without one). Tagged @build: it serves the built dist/mcp-app.html.
 */
test.describe('self-hosted UI for hosts without MCP App rendering @build', () => {
  let client: Client;

  test.beforeAll(async () => {
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', 'server/stdio.ts'],
      env: { ...(process.env as Record<string, string>), BUS_PORT },
    });
    client = new Client({ name: 'no-app-host', version: '0.0.1' });
    await client.connect(transport);
  });

  test.afterAll(async () => {
    await client?.close();
  });

  async function call(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const result = (await client.callTool({ name, arguments: args }, { timeout: 60_000 })) as CallToolResult;
    return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  }

  test('open_video_studio names a localhost page that becomes the UI when opened', async ({ page }) => {
    test.setTimeout(90_000);
    const opened = (await client.callTool({ name: 'open_video_studio', arguments: {} })) as CallToolResult;
    const uiUrl = (opened.structuredContent as { uiUrl?: string }).uiUrl;
    expect(uiUrl).toBe(`http://localhost:${BUS_PORT}/?bus=http://localhost:${BUS_PORT}`);

    await page.goto(uiUrl!);
    await expect.poll(async () => (await call('get_state')).ok, { timeout: 30_000 }).toBe(true);

    expect(await call('load_video', { source: 'sample', id: 'sprite-fight' })).toMatchObject({ ok: true });
    expect(await call('seek', { time: '0:30' })).toMatchObject({ ok: true, summary: expect.stringContaining('00:30') });
    const captured = (await client.callTool({ name: 'capture_frame', arguments: {} }, { timeout: 60_000 })) as CallToolResult;
    expect(captured.content.some((c) => c.type === 'image')).toBe(true);
  });
});
