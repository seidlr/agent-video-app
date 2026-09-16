# Per-host connection guide

Agent Video Studio exposes its tools through several transports at once; a given host uses
whichever it supports natively. `get_state`'s result always works the same way regardless of
which transport carried the call.

## Chrome 152+ (native WebMCP)

Chrome's own `navigator.modelContext` API. Enable it once per profile:

1. Go to `chrome://flags/#enable-webmcp-testing` and set it to **Enabled**.
2. Relaunch Chrome.
3. Open `https://seidlr.github.io/agent-video-app/`. The tool set registers automatically; no
   extension or extra step needed.

## ChatGPT Desktop and Codex sessions in a Chromium-based browser (site tools)

Both surface the same underlying WebMCP registration when the host's own "site tools" / "browser
tools" permission is enabled for this origin:

1. Settings -> Browser -> Permissions -> enable site tools (exact wording varies by host/version).
2. Open the site; the host lists the registered tools the same way Chrome's native inspector does.

## MCP-B (the `@mcp-b/global` extension/polyfill)

For a host or browser without native `navigator.modelContext` support yet, install the MCP-B
extension, then connect to it from Claude Desktop (or another MCP-B-aware client) the same way you
would connect to any other MCP-B-registered site.

## Claude in Chrome / Claude Desktop's own browser (scripting bridge)

No extension needed. Open the site, then drive it via `javascript_tool`/page-scripting using the
`window.agentVideo` bridge it exposes on every page load:

```js
await window.agentVideo.call('load_video', { source: 'sample', id: 'sprite-fight' });
await window.agentVideo.call('get_state', {});
```

`agentVideo.call(name, args)` returns the same `{ok, ...}` envelope every other transport does, and
every call is logged to the Activity panel with `via:"bridge"` so a human watching the tab can see
what the agent just did.

## Claude Desktop (MCP App)

1. Run `npm run mcp:bundle` to produce `agent-video-studio.mcpb` at the repo root.
2. Claude Desktop -> Settings -> Extensions -> install the `.mcpb` file.
3. Start a new conversation and ask Claude to open the video studio. Claude Desktop then has an
   `open_video_studio` tool that renders the studio as an MCP App; every other tool (seek,
   capture_frame, segment, transcribe, ...) dispatches through an instance-bound command bus to
   whichever UI instance (the rendered MCP App, or a normal browser tab) is currently active.

## Codex CLI (HTTP bus)

Codex CLI has no MCP App rendering, so a plain browser tab of the site acts as its UI instead:

1. Run `npm run build:server` once, then: `codex mcp add agent-video-studio -- node <repo>/server/dist/stdio.js`
2. Open the site (deployed, or `npm run dev`) with `?bus=http://localhost:3333` in a normal browser
   tab -- that tab is the session's only UI instance. Don't also call `open_video_studio` in this
   mode; it registers a second, competing UI instance that retires the tab you just opened.

## Verifying a connection

Any host, once connected, should be able to call `get_state` and get back a real result (not an
error). If it can't see the tools at all, check:

- The page actually finished loading (`document.readyState === 'complete'`) -- tools register
  after mount.
- For Chrome's native flag: confirm at `chrome://flags/#enable-webmcp-testing` that it's still
  enabled (flags reset on some updates).
- For the bridge: `window.agentVideo` is a plain page global -- if your scripting tool runs in an
  isolated world (a content-script sandbox) rather than the page's own main world, it won't see it.
