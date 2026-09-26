import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import cors from 'cors';
import { createCommandBus } from './bus.js';
import { BUS_JSON_BODY_LIMIT, createBusRouter } from './bus-http.js';
import { createServer, readBundledAppHtml } from './index.js';

const GITHUB_PAGES_ORIGIN = 'https://seidlr.github.io';
const DEV_ORIGIN = 'http://localhost:3000';
/** stdio has exactly one implicit MCP session for the whole process's lifetime (Key Decisions) --
 * there is no `Mcp-Session-Id` header to generate one from, since stdio carries no HTTP request at
 * all. Every bus operation for this process uses this one constant. */
export const STDIO_SESSION_ID = 'stdio';

/**
 * Entry point for Claude Desktop's `.mcpb` bundle (`server.entry_point` in `server/manifest.json`)
 * and Codex CLI (`codex mcp add ... -- node server/dist/stdio.js`). Starts the MCP connection
 * over stdio, and -- alongside it, not instead of it -- an HTTP listener on `BUS_PORT` (env var,
 * default 3333) serving only the plain bus REST endpoints, so a UI-less client like Codex CLI
 * (which has no way to render the MCP App's iframe itself) can point a normal browser tab at
 * `<site>?bus=http://localhost:3333` to act as that same stdio session's UI instance.
 */
async function main(): Promise<void> {
  const busPort = parseInt(process.env.BUS_PORT ?? '3333', 10);
  // The studio served by this process on its own bus port: the UI for any host that can't render
  // the MCP App itself (Codex CLI, a Claude Code session), handed to the agent by
  // open_video_studio and by every ui_not_connected. Served here rather than pointing at the
  // deployed site because Chrome now blocks a public https page from reaching http://localhost
  // without a Local Network Access permission (confirmed live, Chrome 154: "Permission was denied
  // for this request to access the `loopback` address space"), which a headless or embedded agent
  // browser can't grant -- same-origin needs neither that nor CORS, and matches this server's
  // own version of the app.
  const uiFallbackUrl = `http://localhost:${busPort}/?bus=http://localhost:${busPort}`;
  const bus = createCommandBus({ uiFallbackUrl });
  const server = createServer(STDIO_SESSION_ID, bus, { uiFallbackUrl });
  await server.connect(new StdioServerTransport());

  // 'localhost', not '0.0.0.0' -- see server/http.ts's own comment on why (DNS rebinding
  // protection, enabled automatically for 'localhost'/'127.0.0.1' but not '0.0.0.0').
  const busApp = createMcpExpressApp({ host: 'localhost', jsonLimit: BUS_JSON_BODY_LIMIT });
  busApp.use(cors({ origin: [DEV_ORIGIN, GITHUB_PAGES_ORIGIN] }));
  busApp.use(createBusRouter(bus, STDIO_SESSION_ID));
  busApp.get('/', (_req, res) => {
    readBundledAppHtml()
      .then((html) => res.type('html').send(html))
      .catch(() => res.status(500).type('text').send('The studio page is missing from this build (dist/mcp-app.html). Run npm run build:mcp-app.'));
  });
  busApp.listen(busPort, () => {
    console.error(`Agent Video Studio bus listening on http://localhost:${busPort} (open the site with ?bus=http://localhost:${busPort})`);
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
