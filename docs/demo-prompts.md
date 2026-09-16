# Demo prompts

Copy any of these into an agent already connected to Agent Video Studio (see
[`docs/agents.md`](agents.md) for how to connect). Each one exercises a real chain of tool calls
against the loaded video -- none of these are canned; every result comes from a real local model
run in the browser.

## The three core prompts

1. **"Load the sample, find the moment the character jumps, capture that frame and add a note."**
   Exercises `load_video`, `search_frames` (or `detect_pose`/scrubbing), `capture_frame`, `add_note`.
2. **"Transcribe this and give me chapters with timestamps."**
   Exercises `transcribe`, then `add_chapter` calls derived from the returned segments.
3. **"Track the tent from 0:20 for 5 seconds and export a 3-second clip."**
   Exercises `segment`, `track`, `add_clip`, `export_video`.

## More to try

- **"What's happening in this video? Describe a few frames and tell me the general vibe."**
  A local VLM (`describe_frame`/`describe_range`) narrates without ever leaving the browser.
- **"Read any on-screen text in the last 10 seconds and note down what it says."**
  Florence-2 OCR (`read_text`) -- see `docs/agents.md` for its current status.
- **"Remove the background here and make it transparent, then export a clip."**
  `remove_background` with `replace:'transparent'` forces a WebM/VP9-with-alpha export.
- **"Add a spoken voice-over saying 'Welcome to the demo' right at the start."**
  `generate_voiceover` places a Kokoro-generated clip on the timeline, ducked into the next export.
- **"Upscale that frame you just captured."**
  `upscale_frame` runs a tiled swin2SR pass and drops the result back into the Frames tray.
- **"Translate the transcript to German and give me an SRT."**
  `translate_transcript` -- see `docs/agents.md` for its current status.
- **"Find every frame that looks similar to this one."**
  `find_similar_frames`, either DINOv3 embedding similarity or a perceptual hash.
- **"Who's speaking, and when do they pause?"**
  `find_speaker_turns` (pyannote) segments the audio by speaker without transcribing it.
- **"Export a GIF of the first two seconds."**
  `export_gif` -- fast, no ML model needed.
