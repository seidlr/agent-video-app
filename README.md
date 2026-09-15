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

## Connecting an agent

Install the agent skill:

```bash
npx skills add https://seidlr.github.io/agent-video-app/skill.zip
```

See the in-app **Skill** panel for a downloadable zip, a copyable `SKILL.md`, and per-agent
connection steps, or read [`docs/agents.md`](docs/agents.md) /
[`skills/agent-video-studio/`](skills/agent-video-studio/) directly. Discovery metadata is served
at [`/.well-known/agent-skills/index.json`](https://seidlr.github.io/agent-video-app/.well-known/agent-skills/index.json)
and [`/llms.txt`](https://seidlr.github.io/agent-video-app/llms.txt).

## Full docs

Full usage instructions and remaining polish land in Task 14.
