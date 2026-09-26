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

## Hosts that list the tools but don't render MCP Apps

A Claude Code session (including the Code tab in Claude Desktop) can call every tool, but it does
not render the studio: `open_video_studio` succeeds and nothing appears. The result's text and
`uiUrl` name a local page -- `http://localhost:<bus port>/?bus=...`, served by the same server --
that becomes the UI when opened in any browser tab (an agent with a built-in browser can open it
itself). Until something connects, other tools return `ui_not_connected` with the same link after
about 12 s, instead of queuing jobs no UI will run.

Keep that tab in front while the agent works: Chrome doesn't load video in a tab that has never been
shown. The tools report it (`load_video` notes it, `seek`/`capture_frame` return `video_not_ready`
with a hint), and the tab's title changes to "▶ Show this tab" until someone looks at it. Images
that `capture_frame` returns inline are kept under ~512 KB (a JPEG copy if needed) so hosts with a
1 MB tool-result limit accept them; the saved frame keeps full quality.

## Codex CLI (HTTP bus)

Codex CLI has no MCP App rendering, so a plain browser tab of the site acts as its UI instead:

1. Run `npm run build:mcp-app && npm run build:server` once, then:
   `codex mcp add agent-video-studio --env BUS_PORT=3334 -- node <repo>/server/dist/stdio.js`
   (its own port: the Claude Desktop extension, if installed, already serves its bus on the default
   3333, and a tab pointed at a shared port can silently attach to the wrong server).
2. Open `http://localhost:3334/?bus=http://localhost:3334` in a normal browser tab -- the studio,
   served by the MCP server itself. That tab is the session's only UI instance. Prefer it over the
   deployed site with `?bus=`: Chrome now blocks a public https page from reaching `localhost`
   unless you allow "local network access", which headless and embedded browsers can't. The server
   also hands this link to the agent: in `open_video_studio`'s result and in every
   `ui_not_connected`. Once the tab is open, don't call `open_video_studio` again -- it registers a
   second, competing UI instance that retires the tab.
3. Interactive `codex` asks you to approve each tool call. Headless `codex exec` can't ask, so it
   rejects them ("requires approval, but approval policy is never") unless the server's tools are
   pre-approved: add `default_tools_approval_mode = "approve"` under
   `[mcp_servers.agent-video-studio]` in `~/.codex/config.toml`, or pass
   `-c 'mcp_servers.agent-video-studio.default_tools_approval_mode="approve"'` for one run.

## Verifying a connection

Any host, once connected, should be able to call `get_state` and get back a real result (not an
error). If it can't see the tools at all, check:

- The page actually finished loading (`document.readyState === 'complete'`) -- tools register
  after mount.
- For Chrome's native flag: confirm at `chrome://flags/#enable-webmcp-testing` that it's still
  enabled (flags reset on some updates).
- For the bridge: `window.agentVideo` is a plain page global -- if your scripting tool runs in an
  isolated world (a content-script sandbox) rather than the page's own main world, it won't see it.
