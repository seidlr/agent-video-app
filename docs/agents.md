# Connecting an agent to Agent Video Studio

Agent Video Studio (`https://seidlr.github.io/agent-video-app/`) is built for an *external* agent
to drive -- there is no chat UI inside the app. It exposes the same tool registry through several
transports at once; a given host connects through whichever it supports. `get_state`'s result
looks identical regardless of which transport carried the call. This page tracks the current,
verified status of each host path; [`skills/agent-video-studio/references/HOSTS.md`](../skills/agent-video-studio/references/HOSTS.md)
carries the same steps as part of the installable skill bundle.

## Host matrix

| Host | Transport | Status |
|---|---|---|
| Chrome 152+ (native WebMCP) | `navigator.modelContext` | **Verified** -- see below |
| ChatGPT Desktop / Codex sessions in a Chromium browser | site tools (same WebMCP registration) | Unverified -- depends on host-side model/version support (see Unverified items) |
| MCP-B extension (`@mcp-b/global`) | polyfill + cross-tab transport | **Verified** -- this is also the fallback that makes native WebMCP-less browsers work at all |
| Claude in Chrome / Claude Desktop's own browser | `window.agentVideo` scripting bridge | **Verified** |
| Claude Desktop | `.mcpb` MCP App | **Installed live** -- installs, starts and answers `initialize`/`tools/list`/`resources/list` in Claude Desktop; the inline/PiP render in a chat is not yet observed (see Unverified items) |
| ChatGPT Desktop / VS Code / a Claude connector | MCP-over-HTTP connector | Not run -- needs a public HTTPS tunnel; see below |
| Codex CLI (no browser UI) | HTTP command bus driving a normal tab | **Verified live** with codex-cli 0.153.4 (see below) |

### Chrome 152+ (native WebMCP)

1. Go to `chrome://flags/#enable-webmcp-testing`, set it to **Enabled**, relaunch Chrome.
2. Open `https://seidlr.github.io/agent-video-app/`. The tool set registers automatically on page
   load -- no extension or extra step.
3. Verified by this repo's own Playwright suite, which drives every e2e test through
   `navigator.modelContextTesting` (the same registration path `@mcp-b/global` installs), not a
   mocked tool layer.

### ChatGPT Desktop and Codex sessions (site tools)

Both surface the same underlying registration when the host's own "site tools" / "browser tools"
permission is enabled for this origin: Settings -> Browser -> Permissions -> enable site tools
(exact wording varies by host/version). Not independently verified against a live ChatGPT
Desktop or Codex browser session in this repository's own test suite -- see Unverified items.

### MCP-B extension

Install the MCP-B extension in a browser without native `navigator.modelContext` support, then
connect to it from Claude Desktop (or another MCP-B-aware client) the same way you would connect
to any other MCP-B-registered site. `@mcp-b/global` (an app dependency, not a browser extension)
provides the identical polyfill automatically for every visitor regardless of Chrome flags, which
is what every e2e test in this repo actually exercises.

### Claude in Chrome / Claude Desktop's browser (scripting bridge)

No extension needed. Open the site, then drive it via `javascript_tool`/page-scripting using the
`window.agentVideo` bridge every page load installs:

```js
await window.agentVideo.call('load_video', { source: 'sample', id: 'sprite-fight' });
await window.agentVideo.call('get_state', {});
```

Returns the same `{ok, ...}` envelope every other transport does; every call is logged to the
Activity panel with `via:"bridge"` so a human watching the tab can see what the agent just did.
Verified live in this session's own development loop, driving the app exactly this way.

### Claude Desktop (MCP App)

```bash
npm run mcp:bundle   # produces agent-video-studio.mcpb at the repo root
```

Install it via Claude Desktop's Settings → Extensions. Claude Desktop then has an
`open_video_studio` tool that renders the studio as an MCP App: `data` tools (seek, capture_frame,
segment, transcribe, ...) queue to whichever UI instance is currently active, and results --
including `capture_frame` images -- flow back through the app.

Verified: the bundle itself, built and unpacked into an isolated directory with zero dependency on
this repo's own `node_modules`, correctly registers `open_video_studio` and all 70 data tools (the
count grows with each task; `tests/unit/agent-index.test.ts`'s own `EXPECTED_TOOL_NAMES` is the
source of truth) and serves the `ui://agent-video-studio/app.html` resource with the right mime
type and byte-identical content to the built `dist/mcp-app.html` (`server/test/server.test.ts`,
plus a manual live check during Task 11 -- see the plan's own Deviations entries). **Not yet
verified**: an actual install inside a real Claude Desktop app (TS-009's own manual steps) -- see
Unverified items.

### ChatGPT Desktop / VS Code / a Claude connector

These hosts connect from the provider's own cloud, not from `localhost` -- a plain local connector
URL will not work. Run `npm run mcp:dev` (Streamable HTTP on port 3001) and expose it publicly,
e.g. `brew install cloudflared && cloudflared tunnel --url http://localhost:3001`, then add that
HTTPS URL as the host's connector. Not run against a live host in this repository's own
verification -- see Unverified items.

### Codex CLI (HTTP command bus)

Codex CLI has no MCP App rendering, so a plain browser tab of the site acts as its UI instead:

```bash
codex mcp add agent-video-studio --env BUS_PORT=3334 -- node <repo>/server/dist/stdio.js   # after npm run build:server
```

then open the site (deployed, or `npm run dev`) with `?bus=http://localhost:3334` in a normal
browser tab. Codex gets its own bus port because the Claude Desktop extension, once installed,
keeps its server running with the bus on the default 3333 (observed live: Claude Desktop holding
`*:3333`), and a second server could still bind `localhost:3333` alongside it -- so a tab pointed at
the shared port can attach to the wrong server and every Codex call returns `ui_not_connected`.

For headless `codex exec` (no one to click "approve"), pre-approve this server's tools, or every call
fails with "MCP tool call requires approval, but approval policy is never":

```toml
[mcp_servers.agent-video-studio]
default_tools_approval_mode = "approve"
```

(or `-c 'mcp_servers.agent-video-studio.default_tools_approval_mode="approve"'` for a single run).
Interactive `codex` just asks for approval per call.

**Do not also call `open_video_studio` in this mode.** It registers a second, competing UI
instance via the command bus's own `registerInstance`, which always retires every other instance
in the session -- so calling it immediately retires the browser tab you just opened, and the very
next `seek`/`capture_frame`/etc. call hangs and returns `ui_not_connected`. This was found via live
testing while building Task 11 (not assumed), and is why the correct Codex CLI flow never calls a
render tool at all -- the browser tab, once registered, is the session's only UI instance.

Verified end to end via `tests/e2e/bus-http.spec.ts`: a real spawned `server/stdio.ts` process, a
real MCP client, and a real browser tab opened with `?bus=<url>` -- `load_video`, `seek`, and
`capture_frame` (including a real returned `image` content block) all round-trip correctly through
the bus's actual HTTP routes and the tab's own poll loop.

**Verified live with the real Codex CLI (2026-09-26, codex-cli 0.153.4):** `codex exec` started the
built `server/dist/stdio.js` (BUS_PORT 3334, tools pre-approved as above) and, against a real Chrome
tab of `npm run dev` opened with `?bus=http://localhost:3334`, called `load_video` (Sprite Fight),
`get_state`, `seek` 1:24, `capture_frame` (1280x720), `add_chapter` "Camp Site" 01:05-04:10,
`add_note` at 01:24 and `export_notes` markdown -- all seven completed, the tab's Activity showed
each as `MCP bus`, and the exported Markdown carried the right timestamps
(`- [01:05.000 → 04:10.000] Camp Site`, `- [01:24.000] Tent spotted near the fire`). A hidden or
background tab is not a reliable UI instance: its throttled timers delayed registration long enough
that an earlier run got `ui_not_connected`.

## Unverified items

Tracked here rather than silently assumed, per this project's own verification discipline:

- **Chrome's WebMCP origin trial token**: this repo relies on `chrome://flags/#enable-webmcp-testing`
  for local verification; whether an origin-trial token is needed (or available) for the deployed
  `https://seidlr.github.io/agent-video-app/` origin to work without visitors flipping that flag
  themselves has not been checked against Chrome's current origin-trial registry.
- **ChatGPT Desktop's exact model/version requirement** for site tools to appear, and whether its
  site-tools permission surfaces this app's full tool set or a truncated one, has not been
  confirmed against a live ChatGPT Desktop session.
- **Claude Desktop MCP App's storage behavior**: `src/agent/mcpApp.ts` runs a real probe on boot
  (`probeStorageWorks()` in `src/lib/capabilities.ts` -- actually calls `indexedDB.open()` and
  `navigator.storage.getDirectory()`, not just a `typeof` existence check, since a sandboxed iframe
  can have both APIs present yet throw `SecurityError` when invoked) and logs/records the result in
  `StorageState.worksInThisContext`. The probe mechanism itself is unit-tested and confirmed to run
  correctly, but the actual answer -- whether an MCP App's rendered `dist/mcp-app.html` gets its
  own persistent OPFS/IndexedDB origin inside a real Claude Desktop install, or something more
  ephemeral -- has not been observed live, since that needs a real Claude Desktop app. Whoever runs
  TS-009 first should note the console's `[mcp-app] storage probe:` line here.
- **The MCP App render inside a Claude Desktop chat**: the `.mcpb` was installed in a real
  Claude Desktop (2026-09-26) and its log shows the server starting and answering `initialize`,
  `tools/list` and `resources/list`. What has not been observed yet is TS-009's own steps: a chat
  calling `open_video_studio` and the studio rendering inline and in PiP, which needs someone to
  send that chat message.
- **ChatGPT Desktop / VS Code / a Claude connector over a real HTTPS tunnel**: the Streamable HTTP
  transport (`server/http.ts`) is covered by `server.test.ts`'s in-memory-transport tests, but
  connecting an actual one of these hosts through a real `cloudflared` tunnel (TS-011 steps 1-2)
  has not been done.
