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
| Claude Desktop | `.mcpb` MCP App | Planned -- Task 11 |
| Codex CLI (no browser UI) | HTTP command bus driving a normal tab | Planned -- Task 11 |

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

### Claude Desktop (MCP App) and Codex CLI (HTTP bus)

Planned for Task 11: a bundled `.mcpb` extension that renders the studio as a Claude Desktop MCP
App (data tools queued to one bound UI instance, results -- including `capture_frame` images --
flowing back through the app), and an HTTP command bus so a UI-less client like Codex CLI can
drive a normal browser tab of the site the same way. Not available yet; use one of the transports
above in the meantime. This page will be updated with the exact install command and a verified
status once that task lands.

## Unverified items

Tracked here rather than silently assumed, per this project's own verification discipline:

- **Chrome's WebMCP origin trial token**: this repo relies on `chrome://flags/#enable-webmcp-testing`
  for local verification; whether an origin-trial token is needed (or available) for the deployed
  `https://seidlr.github.io/agent-video-app/` origin to work without visitors flipping that flag
  themselves has not been checked against Chrome's current origin-trial registry.
- **ChatGPT Desktop's exact model/version requirement** for site tools to appear, and whether its
  site-tools permission surfaces this app's full tool set or a truncated one, has not been
  confirmed against a live ChatGPT Desktop session.
- **Claude Desktop MCP App's storage behavior**: whether an MCP App's rendered `dist/mcp-app.html`
  gets its own persistent OPFS/IndexedDB origin (as this app's local-storage design assumes) or
  something more ephemeral is an open question for Task 11 to answer and record here.
