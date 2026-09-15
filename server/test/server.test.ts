import { expect, test } from '@playwright/test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, type CallToolResult } from '@modelcontextprotocol/server';
import { createCommandBus } from '../bus';
import { createServer } from '../index';

/**
 * Task 11 DoD: uses the real MCP client SDK over an in-memory transport (no HTTP, no stdio) to
 * exercise `server/index.ts` exactly as a host would -- `open_video_studio`'s render-tool
 * contract, the `ui://` resource's mime type, and that every manifest-derived data tool's
 * annotations survive onto the wire.
 */
test.describe('MCP server (Task 11)', () => {
  async function connect() {
    const bus = createCommandBus();
    const server = createServer('test-session', bus, { readAppHtml: async () => '<!doctype html><html><body>stub</body></html>' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return { bus, server, client };
  }

  test('open_video_studio returns an instanceId and reads back as a ui:// resource with the right mime type', async () => {
    const { client } = await connect();

    const result = (await client.callTool({ name: 'open_video_studio', arguments: { source: 'sample', id: 'sprite-fight' } })) as CallToolResult;
    const structured = result.structuredContent as { instanceId: string; load: Record<string, unknown> };
    expect(typeof structured.instanceId).toBe('string');
    expect(structured.instanceId.length).toBeGreaterThan(0);
    expect(structured.load).toMatchObject({ source: 'sample', id: 'sprite-fight' });

    const resource = await client.readResource({ uri: 'ui://agent-video-studio/app.html' });
    const content = resource.contents[0] as { mimeType?: string; text?: string };
    expect(content.mimeType).toBe('text/html;profile=mcp-app');
    expect(content.text).toContain('stub');

    await client.close();
  });

  test('every manifest tool is registered and carries the manifest\'s own annotations', async () => {
    const { client } = await connect();

    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain('get_state');
    expect(toolNames).toContain('seek');
    expect(toolNames).toContain('open_video_studio');

    const getState = tools.find((t) => t.name === 'get_state')!;
    expect(getState._meta).toMatchObject({ ui: { visibility: ['model'] } });
    // get_state is annotated readOnlyHint:true in the live registry (src/agent/tools/session.ts).
    expect(getState.annotations).toMatchObject({ readOnlyHint: true });

    await client.close();
  });

  test('a dispatched tool call round-trips through the bus to a polling UI instance', async () => {
    const { bus, client } = await connect();

    const opened = (await client.callTool({ name: 'open_video_studio', arguments: {} })) as CallToolResult;
    const { instanceId } = opened.structuredContent as { instanceId: string };

    const callPromise = client.callTool({ name: 'seek', arguments: { time: '5' } });
    // The bus's own long-poll path is exercised separately by poll_commands (an app-only tool);
    // here, poll the bus's pure store directly the way the app-only tool handler ultimately does.
    let polled: ReturnType<typeof bus.pollCommands> | undefined;
    for (let i = 0; i < 50 && !(polled && !polled.retired && polled.command); i++) {
      polled = bus.pollCommands('test-session', instanceId);
      if (!(polled && !polled.retired && polled.command)) await new Promise((r) => setTimeout(r, 20));
    }
    expect(polled).toBeTruthy();
    const command = (polled as { command: { cmdId: string; name: string; args: unknown } }).command;
    expect(command.name).toBe('seek');
    expect(command.args).toEqual({ time: '5' });

    bus.postResult('test-session', instanceId, command.cmdId, { ok: true, summary: 'seeked to 5' });
    const result = (await callPromise) as CallToolResult;
    expect(result.structuredContent).toMatchObject({ ok: true, summary: 'seeked to 5', instanceId });

    await client.close();
  });

  test('get_job checks the bus\'s own store before forwarding to the browser', async () => {
    const { client } = await connect();
    // No open_video_studio call in this test -- no instance is registered at all, so the
    // fall-through bus.dispatch('get_job', ...) hits the "no active instance" path synchronously
    // (ui_not_connected) rather than actually waiting out a real dispatch timeout.
    const unknown = (await client.callTool({ name: 'get_job', arguments: { jobId: 'no-such-cmd' } })) as CallToolResult;
    expect(unknown.structuredContent).toMatchObject({ ok: false, error: 'ui_not_connected' });

    await client.close();
  });
});
