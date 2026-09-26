import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { expect, test } from '@playwright/test';
import { build } from 'esbuild';

const BUS_PORT = '3397';

/** The host page: a real `AppBridge` (the ext-apps SDK's host side) talking to the view through a
 * sandbox proxy, forwarding the view's own tool calls to the real server via `__hostCallTool`. */
const HOST_ENTRY = `
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
window.startHost = async ({ html, csp, toolInput, toolResult, sandboxUrl, displayMode }) => {
  const frame = document.createElement('iframe');
  frame.src = sandboxUrl;
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  frame.style.cssText = 'width:760px;height:560px;border:0';
  document.body.append(frame);
  // Connect before the proxy loads: it announces sandbox-proxy-ready as soon as it runs.
  const bridge = new AppBridge(null, { name: 'spec-host', version: '1.0.0' }, { serverTools: {}, logging: {} }, { hostContext: { displayMode, theme: 'light' } });
  bridge.oncalltool = async (params) => window.__hostCallTool(params.name, params.arguments ?? {});
  const initialized = new Promise((resolve) => { bridge.oninitialized = resolve; });
  bridge.onsandboxready = () => void bridge.sendSandboxResourceReady({ html, csp });
  await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
  await initialized;
  await bridge.sendToolInput({ arguments: toolInput });
  await bridge.sendToolResult(toolResult);

};
`;

/** The spec's sandbox proxy (apps.mdx, "Sandbox proxy"): a different origin from the host, loads
 * the view's raw HTML under the CSP the spec says a host builds from `_meta.ui.csp`, and relays
 * every non-`ui/notifications/sandbox-*` message both ways. */
const SANDBOX_HTML = `<!doctype html><html><body style="margin:0"><script>
const list = (a) => (a || []).join(' ');
const cspFor = (c = {}) => [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' " + list(c.resourceDomains),
  "style-src 'self' 'unsafe-inline' " + list(c.resourceDomains),
  "connect-src 'self' " + list(c.connectDomains),
  "img-src 'self' data: " + list(c.resourceDomains),
  "font-src 'self' " + list(c.resourceDomains),
  "media-src 'self' data: " + list(c.resourceDomains),
  "frame-src " + (list(c.frameDomains) || "'none'"),
  "object-src 'none'",
  "base-uri " + (list(c.baseUriDomains) || "'self'"),
].join('; ');
let inner;
addEventListener('message', (e) => {
  const d = e.data;
  if (e.source === parent) {
    if (d && d.method === 'ui/notifications/sandbox-resource-ready') {
      inner = document.createElement('iframe');
      inner.setAttribute('sandbox', d.params.sandbox || 'allow-scripts allow-same-origin');
      inner.style.cssText = 'width:100%;height:100vh;border:0';
      const meta = '<meta http-equiv="Content-Security-Policy" content="' + cspFor(d.params.csp) + '">';
      inner.srcdoc = d.params.html.replace(/<head[^>]*>/i, (m) => m + meta);
      document.body.appendChild(inner);
    } else if (inner) inner.contentWindow.postMessage(d, '*');
  } else if (inner && e.source === inner.contentWindow) parent.postMessage(d, '*');
});
parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {} }, '*');
</script></body></html>`;

function serve(routes: Record<string, { type: string; body: string }>, host: string): Promise<Server> {
  const server = createServer((req, res) => {
    const route = routes[(req.url ?? '/').split('?')[0]!];
    if (!route) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': route.type }).end(route.body);
  });
  return new Promise((resolve) => server.listen(0, host, () => resolve(server)));
}

/**
 * The studio as an MCP App inside a spec-compliant web host (TS-009's render path, without Claude):
 * double-iframe sandbox, spec CSP from the resource's `_meta.ui.csp`, and the view framed on a real
 * (non-opaque) origin -- the case `isMcpAppContext` used to miss. Tagged @build: it renders the built
 * dist/mcp-app.html.
 */
test.describe('MCP App inside a spec-compliant host @build', () => {
  let client: Client;
  let hostServer: Server;
  let sandboxServer: Server;

  test.beforeAll(async () => {
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', 'server/stdio.ts'],
      env: { ...(process.env as Record<string, string>), BUS_PORT },
    });
    client = new Client({ name: 'spec-host', version: '1.0.0' });
    await client.connect(transport);

    const bundled = await build({ stdin: { contents: HOST_ENTRY, resolveDir: process.cwd(), loader: 'js' }, bundle: true, format: 'esm', write: false, platform: 'browser' });
    hostServer = await serve(
      {
        '/': { type: 'text/html', body: '<!doctype html><html><body><script type="module" src="/host.js"></script></body></html>' },
        '/host.js': { type: 'text/javascript', body: bundled.outputFiles[0]!.text },
      },
      'localhost',
    );
    sandboxServer = await serve({ '/': { type: 'text/html', body: SANDBOX_HTML } }, '127.0.0.1');
  });

  test.afterAll(async () => {
    await client?.close();
    hostServer?.close();
    sandboxServer?.close();
  });

  async function call(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const result = (await client.callTool({ name, arguments: args }, { timeout: 60_000 })) as CallToolResult;
    return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  }

  test('renders, connects, loads the sample from the tool result, and serves seek and capture_frame', async ({ page }) => {
    test.setTimeout(90_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const toolInput = { source: 'sample', id: 'sprite-fight' };
    const opened = (await client.callTool({ name: 'open_video_studio', arguments: toolInput })) as CallToolResult;
    const resource = await client.readResource({ uri: 'ui://agent-video-studio/app.html' });
    const content = resource.contents[0] as { text: string; _meta?: { ui?: { csp?: unknown } } };

    await page.exposeFunction('__hostCallTool', async (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }));
    await page.goto(`http://localhost:${(hostServer.address() as AddressInfo).port}/`);
    await page.waitForFunction(() => typeof (window as unknown as { startHost?: unknown }).startHost === 'function');
    await page.evaluate(
      (args) => (window as unknown as { startHost(a: unknown): Promise<void> }).startHost(args),
      {
        html: content.text,
        csp: content._meta?.ui?.csp,
        toolInput,
        toolResult: { content: opened.content, structuredContent: opened.structuredContent },
        sandboxUrl: `http://127.0.0.1:${(sandboxServer.address() as AddressInfo).port}/`,
        displayMode: 'inline',
      },
    );

    // The view got open_video_studio's result, started polling and loaded the sample itself.
    await expect.poll(async () => (await call('get_state')).summary as string, { timeout: 40_000 }).toContain('Sprite Fight');
    expect(await call('seek', { time: '1:24' })).toMatchObject({ ok: true, summary: expect.stringContaining('01:24') });
    const captured = (await client.callTool({ name: 'capture_frame', arguments: {} }, { timeout: 60_000 })) as CallToolResult;
    expect(captured.content.some((c) => c.type === 'image')).toBe(true);

    await page.screenshot({ path: test.info().outputPath('mcp-app-in-spec-host.png') });
    expect(pageErrors).toEqual([]);
  });
});
