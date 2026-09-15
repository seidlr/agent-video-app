import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import cors from 'cors';
import { createCommandBus } from './bus.js';
import { createBusRouter } from './bus-http.js';
import { createServer } from './index.js';

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
  const bus = createCommandBus();
  const server = createServer(STDIO_SESSION_ID, bus);
  await server.connect(new StdioServerTransport());

  const busPort = parseInt(process.env.BUS_PORT ?? '3333', 10);
  // 'localhost', not '0.0.0.0' -- see server/http.ts's own comment on why (DNS rebinding
  // protection, enabled automatically for 'localhost'/'127.0.0.1' but not '0.0.0.0').
  const busApp = createMcpExpressApp({ host: 'localhost' });
  busApp.use(cors({ origin: [DEV_ORIGIN, GITHUB_PAGES_ORIGIN] }));
  busApp.use(createBusRouter(bus, STDIO_SESSION_ID));
  busApp.listen(busPort, () => {
    console.error(`Agent Video Studio bus listening on http://localhost:${busPort} (open the site with ?bus=http://localhost:${busPort})`);
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
