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
| Studio v2 (current shell) | [`screens/06-studio-v2.dc.html`](https://claude.ai/design/p/c7f5fcb8-7b4f-4a4b-af9d-9f908d533d48?file=screens%2F06-studio-v2.dc.html) | Grouped nav rail, agent-presence chip, labelled timeline lanes, readable Activity cards. Supersedes 01's shell; see [Studio v2](#studio-v2-2026-09-25) |
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

- **TopBar** — brand mark (serif "A" on `clay`), wordmark, breadcrumb, the agent-presence chip (transport · the agent's latest call, updating in place · call count; opens Activity), theme toggle.
- **Stage** — dark video surface, top-left uppercase mono scene badge with a small dot, bottom gradient chrome bar (mono timestamp, progress track with `clay` fill, speed/volume/fullscreen icons), box overlays (`#4fb3d9` blue, distinct from `clay` so agent-drawn boxes never blend into UI chrome) with a mono label chip, translucent mask fill.
- **Filmstrip** — row of thumbnail tiles; since v2 it is the timeline's Frames lane.
- **Timeline** — since v2 a card of labelled lanes (Frames, Chapters as titled blocks, Marks for notes/boxes/tracks/scene cuts, Clips, Time) with a `clay` playhead across all of them, and a mono legend line with live counts.
- **Rail** — since v2 a 70px nav column in three groups (Media: Library, Notes, Frames, Clips · Analyze: Tracking, Vision, Transcript, Effects · Agent: Activity, Models, Skill), icon over label, active item lifted onto `surface`; the panel has a title and a one-line count.
- **Activity feed / tool-call card** — colored status dot, tool name in mono, a status pill (`good-soft` done, `clay-soft` running, `chip` error), the tool's own summary sentence, transport chip and time, and the raw args/result JSON behind a Details toggle in the dark mono block.
- **Frame card** — dark thumbnail, mono timestamp badge, green "saved" badge when downloaded, filename + size row.
- **Model row** — name, a status pill (`good-soft` loaded, `chip` cached, `surface-2` not loaded) and Load/Unload on one line; family · device · size · license below — the visual contract for the on-demand loading rule in Global Constraints.
- **Export panel** — format switcher chips (`clay` selected), dark mono preview pane matching a terminal, not the light theme (deliberate contrast so exported text reads as "data").
- **MCP App card** — same Stage/chrome vocabulary at a smaller scale, framed inside a host chat bubble; a separate compact PiP card at 260px wide with a minimal chrome row.

## Drift checkpoint (Task 6)

`open-claude-design sync review c7f5fcb8-7b4f-4a4b-af9d-9f908d533d48 --direction to-code --pair 'screens/01-studio.dc.html=src/App.tsx' --pair 'screens/04-transcript-notes-export.dc.html=src/components/Panels/Notes.tsx'` (review only, no apply) — **review id `438a8810c0babe077709b6736cd82a4c`**. Compared a live 1440×900 screenshot of `http://localhost:3000` (studio view and the Notes panel) against the two deliverable screens. Differences found:

- **Timeline legend**: the mockup's `01-studio.dc.html` shows a fourth item, `Track: tent (0:08–0:22)`, next to `Chapters · N`/`Notes · M`/`Boxes · K`. Tracks don't exist until Task 7, so `Timeline.tsx`'s legend only has the three counts today — expected to gain the fourth once Task 7 ships tracks, not a defect to fix now.
- **Export UI shape**: the mockup's `04-transcript-notes-export.dc.html` shows a single-select row of format chips next to one live dark-mono preview pane (pick a format, see its rendered text). The implemented `Notes.tsx` instead lists all six formats as separate rows, each with its own Download and Copy button — this follows Task 6's own written Key Decisions ("the Notes panel 'Export' menu offers all six formats and a 'Copy' button next to 'Download' for each"), which is the later, more specific authority on this screen's shape than the Task 1 mockup. Deliberate, not reconciled back to the mockup's chip+preview layout.
- **Markdown export timestamp format**: the mockup's preview text uses full `HH:MM:SS.mmm` timestamps (e.g. `[00:01:24.400]`). The actual `exportMarkdown` (and TS-004's own explicit expected text, e.g. `- [00:01.500] Red scene starts #scene`) uses the app-wide compact `MM:SS.mmm` form instead. The implementation follows the authoritative TS-004 test scenario over the earlier mockup text.
- Everything else checked (TopBar theme toggle, agent-transport pill, tab bar, timeline track/thumb, chapter/note/box tick colors) matches the token map and component inventory above with no drift.

## Sync status (Task 14)

Decision (user-confirmed): the five Task 1 screens stay the **design-of-record**; the panels added
after Task 6 (Vision, Clips, Effects, the click-to-run controls, ...) have no mockup and are
implemented against the same token/component vocabulary. `06-studio-v2` (2026-09-25, below)
supersedes 01's shell; 02-05 still stand for their own surfaces. Every screen has now been compared
against the live app; all reviews are **review only, no apply** -- the design project was not
modified and nothing was moved into code.

- `01-studio` + `04-transcript-notes-export`: review `438a8810c0babe077709b6736cd82a4c` (Task 6 checkpoint above).
- `02-library-empty`, `03-frames-tracking`, `05-mcp-app-inline-pip`: review **`c1c62da86891f479ae9b000cba24e19a`**
  (`open-claude-design sync review c7f5fcb8-7b4f-4a4b-af9d-9f908d533d48 --direction to-code`, pairs:
  `02` = `Panels/Library.tsx`; `03` = `Panels/Frames.tsx` + `Panels/Tracking.tsx`; `05` = `agent/mcpApp.ts` + `App.tsx`).
  Compared the pulled design renders against live 1440x900 screenshots of `http://localhost:3000`.

Differences found (deliberate unless marked otherwise; none reconciled back to the mockups):

- **02 Library empty state.** The mockup is a full-page centered empty state ("Load a video to get
  started": drop zone, *Sample library*, a *Connect an agent* card, the `npx skills add` command). The
  app keeps its one two-pane shell in every state: the stage shows the user-requested `WelcomeExplainer`
  and the Library panel sits in the rail (drop zone, samples, *Your videos*, *Import project*, storage
  usage). The connect-an-agent list and install command live in the Skill tab. The mockup's
  second sample, **Big Buck Bunny (clip)**, does not exist in the app (only Sprite Fight) -- a real gap,
  not a deliberate change. The transport pill reads "Bridge · connected" (the scripting bridge is always
  installed) instead of "No agent connected", and the app adds the theme toggle.
- **03 Frames + Tracking.** The mockup puts the Frames grid in the main area (3 columns, "saved" badge,
  filename + size row) and shows Tracking as per-keyframe score bars plus an on-demand Models list in
  the rail. The app shows Frames as a 2-column tray in the rail (timestamp and dimensions, with
  Describe / Read text / Upscale), Tracking as a box list (label editing, Draw box, Segment, Track 3s,
  a one-line keyframe summary, no per-keyframe score bars), and Models as its own tab.
- **05 MCP App.** In `displayMode:'inline'` the app renders the full studio shell including the 392px
  rail; the mockup's inline view is a compact card (stage, chrome, "Chapters · N · Notes · N · via MCP
  App" legend, "pop out" chip). Only `displayMode:'pip'` switches to the compact `focus` layout
  (`mcpApp.ts`), which keeps the top bar and full timeline rather than the mockup's minimal chrome row.
  There is no in-app "pop out" control (the host owns display mode). Neither mode was observed inside a
  real host (TS-009), so this is checked from the code path and a standalone render only.

Found while doing this review and fixed (see the plan's Deviations): the `<video>` rendered at its
intrinsic size instead of filling the stage, so boxes and masks (percent-positioned on the stage) sat
off the object whenever the video was smaller than the stage.

## Studio v2 (2026-09-25)

User request: use Claude Design to make the app nicer to use for humans and agents, with "not so
many toasts". One direction inside the existing token system (the 1a/1b palettes are the user's
earlier choice and were not reopened), drafted as `screens/06-studio-v2.dc.html` (verified push,
etag `1790370449803084`) and then implemented. What it changes, and why:

- **Grouped nav rail** instead of eleven tabs wrapping to three rows in a 392px rail.
- **One agent-presence chip** in the top bar instead of a toast per tool call: the agent's latest
  call updates in place, so a burst of calls never covers the video. The Activity nav item shows a
  pulsing dot while a call is running.
- **Labelled timeline lanes** with chapter titles and a playhead across every lane, instead of a
  thin bar with unlabelled ticks.
- **Readable Activity cards**: the tool's own summary sentence first, raw JSON on demand.
- **Copy**: no internal plan jargon ("(Task 9)") in the Library's storage note; an unknown
  duration is omitted rather than shown as "…". The rail opens on Library, where the empty-state
  explainer sends a newcomer.

Decided while implementing, beyond the mock:

- The Time lane is always one continuous scrub bar. Vidstack's segmented `TimeSlider.Chapters` kept
  stale per-segment fills when chapters were added one at a time (a later segment filling to an
  earlier one's percentage); the Chapters lane now carries the segmentation.
- Below 1024px (an inline MCP App card, a narrow window) the rail stacks under the video instead of
  squeezing it, and the top bar drops the wordmark, breadcrumb and call count in that order; at PiP
  size the chip still shows the latest call.
- Models became compact rows (not in the mock, same vocabulary).

## Visual rules for implementation

- Contrast: body/label text is full-opacity `ink` on `bg`/`surface` (verified ≥4.5:1 in both palettes); never alpha-muted text for anything under 18px.
- The box-overlay blue (`#4fb3d9`) is reserved for agent-drawn annotations (boxes, masks, tracks) and never reused as a UI color — keeps "what the agent found" visually distinct from "what the UI is doing" (`clay`).
- Mono type is reserved for machine-readable values: timestamps, scores, sizes, statuses, tool names. Sans is reserved for prose and labels. Serif is reserved for the brand mark and, later, the video caption overlay.
- Dark mode swaps tokens only — no component gets separate markup or spacing for dark; `.dark`/`prefers-color-scheme: dark` redefine the custom properties exactly as shown in `system/tokens.dc.html`.
- Desktop-only target (≥1024px), matching the plan's Global Constraints; these screens are not responsive mockups.
