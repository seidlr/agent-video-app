# Agent Video Studio — MCP server

The MCP server behind [Agent Video Studio](https://seidlr.github.io/agent-video-app/): a small
Node/Express + `@modelcontextprotocol/server` app that exposes the studio's tool registry
(`../src/agent/registry.ts`) to MCP hosts and dispatches every call to whichever browser tab or
MCP App view is currently active, via an instance-bound command bus (`bus.ts`).

## Pieces

- `bus.ts` — pure, unit-tested command bus: instance registration/activation, dispatch with a
  15s "no active instance" timeout and a 25s result wait before handing back a job id, result
  storage keyed by `cmdId` (10 min TTL) so a late `post_result` after the caller gave up is still
  retrievable via `get_job`.
- `index.ts` — `createServer(busSessionId, bus, options?)`: registers `open_video_studio` (an
  MCP App render tool, `_meta.ui.resourceUri: 'ui://agent-video-studio/app.html'`), the `ui://`
  resource itself (serves the built `dist/mcp-app.html`), every manifest tool as a passthrough
  to `bus.dispatch`, and the app-only bus tools (`poll_commands`, `post_result`,
  `activate_instance`, `retire_instance`).
- `http.ts` — stateful Streamable HTTP transport (one `McpServer` per MCP session) plus the HTTP
  bus routes, for connector-based hosts (ChatGPT Desktop, VS Code, Claude connectors) and for
  local development (`npm run mcp:dev`).
- `stdio.ts` — stdio transport (Claude Desktop's local `.mcpb` extensions) with an implicit single
  session; also starts the HTTP bus listener on `BUS_PORT` (default 3333) so a plain browser tab
  opened with `?bus=http://localhost:3333` (Codex CLI and any other UI-less MCP client) can join
  the same session over `src/agent/busClient.ts`.
- `csp.ts`, `schema.ts`, `bus-http.ts` — CSP domain lists for the MCP App resource, the
  `inputSchema` → Standard Schema adapter `registerTool` requires, and the `/bus/*` REST routes.
- `generated/tool-manifest.json` — the serializable tool manifest `scripts/build-server-manifest.ts`
  regenerates from the live registry on every `npm run build`; `index.ts` reads it to register one
  passthrough data tool per entry.

## Connecting a host

- **Claude Desktop** (local, stdio): `npm run mcp:bundle` packs this directory into
  `agent-video-studio.mcpb` at the repo root (manifest v0.3, `server.type: node`, entry
  `dist/stdio.js`) — install it via Settings → Extensions. The bundle is self-contained: its build
  step (`npm run build:server`) bundles every dependency (Express, the MCP SDK, zod, ...) into one
  `dist/stdio.js` with `esbuild`, and copies the current `dist/mcp-app.html` (run
  `npm run build:mcp-app` first) in alongside it so `open_video_studio`'s `ui://` resource has
  something to serve.
- **ChatGPT Desktop / VS Code / a Claude connector** (HTTPS connector): these hosts connect from
  the provider's own cloud, not from `localhost` — a plain local connector URL will not work. Run
  `npm run mcp:dev` (stateful Streamable HTTP on port 3001) and expose it publicly, e.g.
  `brew install cloudflared && cloudflared tunnel --url http://localhost:3001`, then add that
  HTTPS URL as the host's connector.
- **Codex CLI** (a plain MCP client with no MCP App rendering): `codex mcp add agent-video-studio -- node <repo>/server/dist/stdio.js`, then open the deployed site (or `npm run dev`) with
  `?bus=http://localhost:3333` in a normal browser tab — that tab, not a phantom
  `open_video_studio`-registered instance, is the one Codex's tool calls reach. **Do not call
  `open_video_studio` in this mode**: it registers a second, competing instance via
  `bus.registerInstance`, which immediately retires the browser tab's own already-registered
  instance (an instance-bound bus always keeps exactly one active member per session) — a
  subsequent `seek`/`capture_frame`/etc. call then hangs and returns `ui_not_connected`. This was
  found via live testing while building Task 11, not assumed; see the plan's own Deviations entry.

## Development

- `npm run mcp:dev` — `tsx watch server/http.ts`, for iterating against the Streamable HTTP
  transport without rebuilding.
- `npm run mcp:stdio` — `tsx server/stdio.ts`, the stdio transport run directly from source.
- `npm test -- command-bus` — the bus's own unit tests.
- `npx playwright test server/test/server.test.ts` — exercises `createServer` through a real
  in-memory MCP client (`server/test/**/*.test.ts` is included in `playwright.config.ts`'s own
  `testMatch` specifically so these tests share its Chromium-dependent fixtures where needed).

`server/tsconfig.json` is a standalone, `noEmit` project reference for editors opening this
directory on its own (and for `npm run typecheck`, via the root `tsconfig.json`'s references) --
the actual `dist/stdio.js` used by `.mcpb` installs is produced by `scripts/build-server.ts`
(esbuild), not `tsc`, since these source files use the same extension-less relative-import
convention as the rest of the repo, which Node's own `NodeNext` module resolution does not accept
at the file extensions `tsc` would otherwise require for a real emit.
