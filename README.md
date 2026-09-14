# Agent Video Studio

An agent-first video player and editor. Load a video — a sample, a URL, a YouTube link, or a
local file — and let an external agent (Claude Desktop, ChatGPT, Codex, Claude in Chrome) seek,
capture, segment, transcribe, and take notes through WebMCP tools, an MCP App, or a scripting
bridge. Front-end only: every byte stays in the browser (OPFS + IndexedDB), and every ML model
downloads only when an agent or user actually asks for it.

> Status: under active development. See [`docs/plans/2026-09-14-agent-first-video-player.md`](docs/plans/2026-09-14-agent-first-video-player.md)
> for the full implementation plan and [`docs/design/DESIGN.md`](docs/design/DESIGN.md) for the
> design system.

## Run locally

```bash
npm install
npm run dev
```

Opens at `http://localhost:3000`.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run e2e
```

## Generate the test fixture video

```bash
npm run make-fixture
```

Regenerates `tests/fixtures/cuts.mp4` (committed; CI does not regenerate it).

## Full docs

Full usage instructions, the agent host matrix, and the skill install command land in Task 14.
