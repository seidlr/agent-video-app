# Agent Video Studio — Design

**Claude Design project:** [Agent Video Studio](https://claude.ai/design/p/c7f5fcb8-7b4f-4a4b-af9d-9f908d533d48) (`c7f5fcb8-7b4f-4a4b-af9d-9f908d533d48`)

## Direction

Three directions were explored on one canvas (`explorations/directions.dc.html`, option ids `1a`/`1b`/`1c`):

- **1a — Warm editorial**: cream background, terracotta accent, serif captions and Fraunces brand mark. Evolves the earlier Lumen Studio look from `../agent-video-player`.
- **1b — Dark grading suite**: charcoal background, cyan telemetry accent, monospace-forward.
- **1c — Editorial light**: paper white, ink black, single indigo accent, serif numerals.

**Selected:** 1a as the default light theme. The user asked to keep 1b as a dark-mode variant rather than discard it, so the token system defines both palettes on the same component vocabulary (see [Deviations](../plans/2026-09-14-agent-first-video-player.md#deviations) in the plan). There is no separate dark-mode screen set — 1b's colors are re-themed onto 1a's layout via CSS custom properties, proven in `system/tokens.dc.html`'s dark-mode reference frame.

## Deliverable screens

| Screen | Claude Design path | Shows |
|---|---|---|
| Studio (loaded video) | [`screens/01-studio.dc.html`](https://claude.ai/design/p/c7f5fcb8-7b4f-4a4b-af9d-9f908d533d48?file=screens%2F01-studio.dc.html) | Stage with a segmented+masked box, filmstrip, timeline with chapter/note/box ticks and a track bar, Activity feed with tool-call cards, tabbed rail |
| Library (empty state) | [`screens/02-library-empty.dc.html`](https://claude.ai/design/p/c7f5fcb8-7b4f-4a4b-af9d-9f908d533d48?file=screens%2F02-library-empty.dc.html) | Drop zone, sample library cards, "Connect an agent" cards per host, skill install command |
| Frames & Tracking | [`screens/03-frames-tracking.dc.html`](https://claude.ai/design/p/c7f5fcb8-7b4f-4a4b-af9d-9f908d533d48?file=screens%2F03-frames-tracking.dc.html) | Frames grid with a "saved to Downloads" badge, track keyframe list with scores, Models panel with cached/loaded state |
| Transcript, Notes & Export | [`screens/04-transcript-notes-export.dc.html`](https://claude.ai/design/p/c7f5fcb8-7b4f-4a4b-af9d-9f908d533d48?file=screens%2F04-transcript-notes-export.dc.html) | Transcript with a search hit highlighted, Markdown export preview with format switcher |
| MCP App — inline & PiP | [`screens/05-mcp-app-inline-pip.dc.html`](https://claude.ai/design/p/c7f5fcb8-7b4f-4a4b-af9d-9f908d533d48?file=screens%2F05-mcp-app-inline-pip.dc.html) | The studio rendered inline inside a Claude Desktop chat bubble, and the compact PiP variant popped out |
| Token sheet | [`system/tokens.dc.html`](https://claude.ai/design/p/c7f5fcb8-7b4f-4a4b-af9d-9f908d533d48?file=system%2Ftokens.dc.html) | Light + dark swatches, type specimens, radius/spacing notes, dark-mode reference frame |

Every write above returned `verification.verified: true` from the CLI's own render gate (byte-for-byte readback + render check) at push time (2026-09-14).

## Token map → `src/styles/tokens.css`

| Design token | Light value | Dark value | Tailwind 4 utility |
|---|---|---|---|
| `--color-bg` | `#F5F1EB` | `#121417` | `bg-bg` |
| `--color-surface` | `#FAF9F5` | `#181B1F` | `bg-surface` |
| `--color-surface-2` | `#EFEAE0` | `#1C1F23` | `bg-surface-2` |
| `--color-ink` | `#1F1E1C` | `#EEF1F4` | `text-ink` |
| `--color-ink-2` | `#44403B` | `#C7CDD3` | `text-ink-2` |
| `--color-ink-3` | `#6E6A62` | `#8A929C` | `text-ink-3` |
| `--color-ink-4` | `#A8A299` | `#5B6167` | `text-ink-4` |
| `--color-line` | `#E5DFD2` | `#282C31` | `border-line` |
| `--color-line-2` | `#D9D2C2` | `#33383E` | `border-line-2` |
| `--color-clay` (accent) | `#C96442` | `#37E0C4` | `text-clay`, `bg-clay` |
| `--color-clay-soft` | `#EFD9CC` | `#0F2E28` | `bg-clay-soft` |
| `--color-clay-ink` | `#6B2C12` | `#37E0C4` | `text-clay-ink` |
| `--color-good` | `#4F7B4A` | `#5FBF6B` | `text-good`, `bg-good` |
| `--color-good-soft` | `#DDE6D6` | `#16301C` | `bg-good-soft` |
| `--color-warn` | `#B7791F` | `#F2A340` | `text-warn` |
| `--color-chip` | `#ECE6D8` | `#1C1F23` | `bg-chip` |
| `--radius` | `10px` | same | `rounded-token` |
| `--radius-lg` | `14px` | same | `rounded-token-lg` |
| `--font-sans` | Inter | same | `font-sans` |
| `--font-mono` | JetBrains Mono | same | `font-mono` |
| `--font-serif` | Fraunces | same | `font-serif` |

## Component inventory (for Tasks 3–13 to build against)

- **TopBar** — brand mark (serif "A" on `clay`), wordmark, breadcrumb, theme toggle, agent-transport pill (green "MCP App · connected" / neutral "No agent connected").
- **Stage** — dark video surface, top-left uppercase mono scene badge with a small dot, bottom gradient chrome bar (mono timestamp, progress track with `clay` fill, speed/volume/fullscreen icons), box overlays (`#4fb3d9` blue, distinct from `clay` so agent-drawn boxes never blend into UI chrome) with a mono label chip, translucent mask fill.
- **Filmstrip** — row of thumbnail tiles under the stage, current tile outlined in `clay`.
- **Timeline** — track with chapter ticks (`clay`, tall), note ticks (`ink-4`, short), a track-range bar (`#4fb3d9`), and a mono legend line with live counts.
- **Rail / tabs** — `Activity · Notes · Tracking · Vision · Transcript · Models · Skill`, active tab lifted onto the page background.
- **Activity feed / tool-call card** — colored status dot, tool name in mono, a status pill (`good-soft` done, `clay-soft` running, `chip` idle/error), one line of result detail.
- **Frame card** — dark thumbnail, mono timestamp badge, green "saved" badge when downloaded, filename + size row.
- **Model row** — name, size in mono, a status pill (`good-soft` loaded, `chip` cached, `surface-2` not loaded) — this is the visual contract for the on-demand loading rule in Global Constraints.
- **Export panel** — format switcher chips (`clay` selected), dark mono preview pane matching a terminal, not the light theme (deliberate contrast so exported text reads as "data").
- **MCP App card** — same Stage/chrome vocabulary at a smaller scale, framed inside a host chat bubble; a separate compact PiP card at 260px wide with a minimal chrome row.

## Drift checkpoint (Task 6)

`open-claude-design sync review c7f5fcb8-7b4f-4a4b-af9d-9f908d533d48 --direction to-code --pair 'screens/01-studio.dc.html=src/App.tsx' --pair 'screens/04-transcript-notes-export.dc.html=src/components/Panels/Notes.tsx'` (review only, no apply) — **review id `438a8810c0babe077709b6736cd82a4c`**. Compared a live 1440×900 screenshot of `http://localhost:3000` (studio view and the Notes panel) against the two deliverable screens. Differences found:

- **Timeline legend**: the mockup's `01-studio.dc.html` shows a fourth item, `Track: tent (0:08–0:22)`, next to `Chapters · N`/`Notes · M`/`Boxes · K`. Tracks don't exist until Task 7, so `Timeline.tsx`'s legend only has the three counts today — expected to gain the fourth once Task 7 ships tracks, not a defect to fix now.
- **Export UI shape**: the mockup's `04-transcript-notes-export.dc.html` shows a single-select row of format chips next to one live dark-mono preview pane (pick a format, see its rendered text). The implemented `Notes.tsx` instead lists all six formats as separate rows, each with its own Download and Copy button — this follows Task 6's own written Key Decisions ("the Notes panel 'Export' menu offers all six formats and a 'Copy' button next to 'Download' for each"), which is the later, more specific authority on this screen's shape than the Task 1 mockup. Deliberate, not reconciled back to the mockup's chip+preview layout.
- **Markdown export timestamp format**: the mockup's preview text uses full `HH:MM:SS.mmm` timestamps (e.g. `[00:01:24.400]`). The actual `exportMarkdown` (and TS-004's own explicit expected text, e.g. `- [00:01.500] Red scene starts #scene`) uses the app-wide compact `MM:SS.mmm` form instead. The implementation follows the authoritative TS-004 test scenario over the earlier mockup text.
- Everything else checked (TopBar theme toggle, agent-transport pill, tab bar, timeline track/thumb, chapter/note/box tick colors) matches the token map and component inventory above with no drift.

## Visual rules for implementation

- Contrast: body/label text is full-opacity `ink` on `bg`/`surface` (verified ≥4.5:1 in both palettes); never alpha-muted text for anything under 18px.
- The box-overlay blue (`#4fb3d9`) is reserved for agent-drawn annotations (boxes, masks, tracks) and never reused as a UI color — keeps "what the agent found" visually distinct from "what the UI is doing" (`clay`).
- Mono type is reserved for machine-readable values: timestamps, scores, sizes, statuses, tool names. Sans is reserved for prose and labels. Serif is reserved for the brand mark and, later, the video caption overlay.
- Dark mode swaps tokens only — no component gets separate markup or spacing for dark; `.dark`/`prefers-color-scheme: dark` redefine the custom properties exactly as shown in `system/tokens.dc.html`.
- Desktop-only target (≥1024px), matching the plan's Global Constraints; these screens are not responsive mockups.
