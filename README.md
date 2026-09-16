# Agent Video Studio

**An agent-first video player and editor.** There is no chat UI inside the app — it's a surface
for an *external* agent (Claude Desktop, ChatGPT, Codex, Claude in Chrome) to drive through real
tool calls: seek, capture frames, segment and track objects, transcribe, describe what's on
screen, remove backgrounds, add a voice-over, and export a clip. A human can use it directly too,
but every feature is designed tool-call-first.

Front-end only, nothing leaves the browser: video bytes live in OPFS, notes/boxes/transcripts in
IndexedDB, and every ML model downloads on demand — the first time a tool that needs it is
actually called, cached afterward, never preloaded speculatively.

Live at **[seidlr.github.io/agent-video-app](https://seidlr.github.io/agent-video-app/)**.

## Try it in 30 seconds

1. Open the [live site](https://seidlr.github.io/agent-video-app/) in Chrome/Chromium.
2. Connect an agent — see [Connecting an agent](#connecting-an-agent) below, or just use the
   in-app **Skill** panel.
3. Ask it one of the [demo prompts](docs/demo-prompts.md), for example:
   > "Load the sample, find the moment the character jumps, capture that frame and add a note."

Every result is a real local model run in your own browser — nothing is mocked or pre-recorded.

## What it can do

| Area | Tools (abridged) |
|---|---|
| Playback | `load_video`, `seek`, `play`/`pause`, `set_playback`, `capture_frame` |
| Notes & structure | `add_note`, `add_chapter`, `import_vtt`, `export_notes` (md/json/vtt/srt/csv/edl) |
| Boxes & tracking | `add_box`, `segment` (EdgeTAM/SlimSAM), `track`, `detect_objects`, `detect_faces`, `detect_pose` |
| Analysis | `detect_scenes`, `search_frames`, `find_similar_frames`, `estimate_depth` |
| Speech & audio | `transcribe` (Whisper tiny/base/turbo, Moonshine), `search_transcript`, `translate_transcript`, `find_speaker_turns`, `tag_audio_events` |
| Vision-language | `describe_frame`, `ask_about_frame`, `describe_range` (a local VLM), `read_text`/`dense_captions`/`ground_phrase` (Florence-2) |
| Effects | `remove_background` (background matting), `generate_voiceover` (Kokoro TTS), `upscale_frame` (swin2SR) |
| Clips & export | `add_clip`, `export_video` (mp4/webm), `export_gif`, `export_project` |

See the in-app **Skill** panel or [`skills/agent-video-studio/`](skills/agent-video-studio/) for
the full tool list with schemas.

## Model sizes

Every model is fetched only when its tool is first called, with a `confirmDownload` gate that
reports the exact size before downloading. Roughly, by family:

| Family | Smallest | Largest |
|---|---|---|
| Segmentation (EdgeTAM/SlimSAM) | 14 MB | 31 MB |
| Detection (RF-DETR/YOLOS/Grounding DINO) | 7 MB | 151 MB |
| Speech-to-text (Whisper tiny → large-v3-turbo, Moonshine) | 102 MB | 563 MB |
| Vision-language (SmolVLM → Qwen3.5, Florence-2) | 189 MB | 647 MB |
| Background matting (MODNet/BiRefNet) | 7 MB | 115 MB |
| Voice-over (Kokoro) | 92 MB | 92 MB |
| Upscaling (swin2SR) | 15 MB | 15 MB |
| Translation (opus-mt, per language pair) | 219 MB | 240 MB |

The full, byte-verified list is in [`src/ml/catalog.ts`](src/ml/catalog.ts) and the Models panel.

## Browser floor

Real Chrome or a Chromium-based browser (`channel:'chrome'`, not the open-source Chromium build —
the sample/fixture videos are H.264+AAC, which only real Chrome's WebCodecs implementation
decodes). WebGPU is preferred for every model with a wasm fallback (add `?ml=wasm` to force it).
Needs OPFS (`navigator.storage.getDirectory`) and IndexedDB for storage — every modern Chromium
build has both.

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

`@ml`-tagged e2e tests do real model downloads/inference and are excluded from the default `npm run e2e`
run; run them explicitly with `npx playwright test --grep @ml`.

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

`docs/agents.md` tracks the current, live-verified status of every host path (native WebMCP,
Claude in Chrome's scripting bridge, Claude Desktop's MCP App, Codex CLI's HTTP bus, and so on) —
check there before assuming a given host works out of the box.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  External agent (Claude Desktop, ChatGPT, Codex, Claude in   │
│  Chrome) -- connects via whichever transport its host offers │
└───────────────────────────┬───────────────────────────────────┘
                             │  WebMCP / MCP App / scripting bridge / HTTP bus
┌───────────────────────────▼───────────────────────────────────┐
│  Tool registry (src/agent) -- one set of tools, several       │
│  transports; every call returns {ok, ...}/{ok:false, error}   │
└───────┬─────────────────────────────────────────┬─────────────┘
        │                                         │
┌───────▼────────┐                     ┌──────────▼──────────┐
│ Zustand store   │◄───────────────────►│ ML workers (one per │
│ (src/store) --  │  captures/results   │ model family) --    │
│ player, notes,  │                     │ segment/detect/asr/ │
│ boxes, effects  │                     │ vlm/matte/tts/...   │
└───────┬─────────┘                     └──────────────────────┘
        │
┌───────▼─────────────────────────────────────────────────────┐
│  Browser storage -- OPFS (video bytes, mattes, sprites) +    │
│  IndexedDB (notes/boxes/transcripts/frames), nothing leaves  │
│  the browser                                                  │
└────────────────────────────────────────────────────────────────┘
```

## License

[MIT](LICENSE)

---

> See [`docs/plans/2026-09-14-agent-first-video-player.md`](docs/plans/2026-09-14-agent-first-video-player.md)
> for the full implementation plan (including every real bug found and fixed along the way) and
> [`docs/design/DESIGN.md`](docs/design/DESIGN.md) for the design system.
