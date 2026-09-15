import { randomUUID } from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import cors from 'cors';
import type { Request, Response } from 'express';
import { createCommandBus } from './bus.js';
import { createBusRouter } from './bus-http.js';
import { createServer } from './index.js';

const GITHUB_PAGES_ORIGIN = 'https://seidlr.github.io';
const DEV_ORIGIN = 'http://localhost:3000';
/** Matches `server/stdio.ts`'s own constant -- see its doc comment on why the bus endpoints use
 * one fixed session rather than a per-connection one. */
export const STDIO_SESSION_ID = 'stdio';

interface SessionEntry {
  transport: NodeStreamableHTTPServerTransport;
}

/**
 * Streamable HTTP transport (Task 11), for connector-based hosts (ChatGPT Desktop, VS Code) that
 * render the MCP App directly over a public HTTPS tunnel -- `npm run mcp:dev`. Stateful: each new
 * connection gets its own `McpServer` bound to a freshly generated bus session id (closed over by
 * every tool handler at creation time, per `server/index.ts`'s own doc comment on why -- a tool
 * handler's own context exposes no session id), and subsequent requests carrying the resulting
 * `Mcp-Session-Id` header are routed back to that same transport instead of creating a new one.
 * Also mounts the plain HTTP bus endpoints (`createBusRouter`) on the same port, per the plan's
 * own Key Decisions -- symmetrical with `server/stdio.ts`, even though the tested DoD path
 * (`tests/e2e/bus-http.spec.ts`) exercises stdio's own bus listener, not this one.
 */
export async function startHttpServer(port = 3001): Promise<{ close(): Promise<void> }> {
  const bus = createCommandBus();
  const sessions = new Map<string, SessionEntry>();

  // 'localhost' (not '0.0.0.0'): this is a personal local-dev server -- Claude Desktop's .mcpb
  // connects via stdio, and a connector-based host reaches it only through a cloudflared tunnel
  // whose local agent also talks to localhost. createMcpExpressApp enables DNS rebinding
  // protection automatically for 'localhost'/'127.0.0.1' but not for '0.0.0.0' (confirmed via its
  // own doc comment) -- this server dispatches arbitrary tool calls to a real browser instance, so
  // a hostile page exploiting DNS rebinding against an unprotected 0.0.0.0 bind is a real risk,
  // not a hypothetical one.
  const app = createMcpExpressApp({ host: 'localhost' });
  app.use(cors({ origin: [DEV_ORIGIN, GITHUB_PAGES_ORIGIN] }));
  app.use(createBusRouter(bus, STDIO_SESSION_ID));

  app.all('/mcp', async (req: Request, res: Response) => {
    const existingSessionId = req.headers['mcp-session-id'] as string | undefined;
    let entry = existingSessionId ? sessions.get(existingSessionId) : undefined;

    if (!entry) {
      const busSessionId = randomUUID();
      const server = createServer(busSessionId, bus);
      const transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (mcpSessionId: string) => {
          sessions.set(mcpSessionId, entry!);
        },
        onsessionclosed: (mcpSessionId: string) => {
          sessions.delete(mcpSessionId);
        },
      });
      entry = { transport };
      res.on('close', () => {
        if (!existingSessionId) {
          transport.close().catch(() => undefined);
          server.close().catch(() => undefined);
        }
      });
      await server.connect(transport);
    }

    try {
      await entry.transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('MCP error:', error);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  });

  return new Promise((resolve, reject) => {
    const httpServer = app.listen(port, (err?: Error) => {
      if (err) {
        reject(err);
        return;
      }
      console.log(`MCP server listening on http://localhost:${port}/mcp (bus endpoints on the same port under /bus/*)`);
      resolve({ close: () => new Promise((r) => httpServer.close(() => r())) });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.PORT ?? '3001', 10);
  startHttpServer(port).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
