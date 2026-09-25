import { createStore as createVanillaStore } from 'zustand/vanilla';
import { useStore } from 'zustand/react';
import { detectCapabilities, type Capabilities } from '../lib/capabilities';
import type { Box, CapturedFrame, Chapter, Clip, Effect, Note, ToolCall, Track, TranscriptSegment, Voiceover } from '../lib/types';
import type { ResolvedSource } from '../media/source';
import type { Scene } from '../media/scenes';

/** A captured frame plus its in-session display URL (an object URL over the same bytes stored in
 * Dexie's `frames` table -- see src/agent/tools/frames.ts). Not persisted itself; re-created from
 * the stored blob each time the app boots, since object URLs don't survive a reload. */
export interface FrameEntry extends CapturedFrame {
  blobUrl: string;
}

/** Task 12: one VLM/Florence-2 text result (describe_frame/describe_range/ask_about_frame/
 * dense_captions). `time` is the frame's timestamp for a single-frame result, or the range's own
 * `from` for describe_range. */
export interface VisionResult {
  id: string;
  time: number;
  kind: 'describe' | 'describe_range' | 'ask' | 'dense_captions';
  text: string;
  model: string;
}

export interface PlayerState {
  currentTime: number;
  duration: number;
  paused: boolean;
  volume: number;
  muted: boolean;
  rate: number;
  loop: { start: number; end: number } | null;
  fps: number;
  width: number;
  height: number;
}

export type ThemeSetting = 'light' | 'dark' | 'system';
export type AgentTransport = 'webmcp' | 'bridge' | 'mcp-app' | 'mcp-bus' | 'none';
export type PanelId =
  | 'library'
  | 'notes'
  | 'frames'
  | 'tracking'
  | 'vision'
  | 'transcript'
  | 'clips'
  | 'effects'
  | 'models'
  | 'activity'
  | 'skill';

export interface UiState {
  theme: ThemeSetting;
  panel: PanelId;
  layout: 'studio' | 'focus';
  agentTransport: AgentTransport;
  /** For the `mcp-app`/`mcp-bus` transports only (Task 11): whether *this* rendered instance is
   * the bus's currently-active one. A newer instance (another tab, or a fresh MCP App render)
   * always retires the previous one -- `mcpApp.ts`/`busClient.ts`'s poll loops set this to `false`
   * the moment a poll comes back `{retired:true}`. Meaningless (left `true`) for `webmcp`/`bridge`,
   * which have no such instance-hand-off concept. */
  agentInstanceActive: boolean;
}

export interface StorageState {
  persisted: boolean;
  usage: number;
  quota: number;
  /** Set once by the MCP App's own boot-time probe (Task 11 Key Decisions) -- `true` for the main
   * site (never probed, so assumed working, matching every existing best-effort persistence call
   * site's own tolerance for a failed write). `false` only when `probeStorageWorks()` (a real
   * `indexedDB.open`/`storage.getDirectory()` call, not just a `typeof` check) actually threw
   * inside a sandboxed MCP App iframe. */
  worksInThisContext: boolean;
}

/** One catalog model's live state, as `list_models`/the Models panel report it (Task 7's
 * `ml/client.ts` is the only writer). `progress` is only meaningful while `loaded:false` and a
 * download is in flight. */
export interface ModelState {
  cached: boolean;
  loaded: boolean;
  progress: number;
}

/**
 * The subset of @vidstack/react's MediaPlayerInstance the store's imperative player actions
 * need. Kept as a minimal structural interface (not an import from @vidstack/react) so the
 * store stays testable without a real player instance -- MediaPlayerInstance satisfies this
 * shape structurally, so VideoStage can register its real playerRef.current with no adapter.
 */
export interface PlayerHandle {
  currentTime: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  paused: boolean;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: string, listener: () => void): void;
  /** vidstack's own readiness queue (MediaPlayerInstance.canPlayQueue): waitForFlush() resolves
   * once the player can actually play, immediately if it already can. Optional and structural so
   * test doubles that don't need it still satisfy this interface -- play()/togglePlay() below
   * skip the wait when it's absent. Without it, calling play() before enough data has buffered
   * rejects with "media is not ready", uncaught, and playback silently never starts; confirmed as
   * a real (not just test-only) race in tests/e2e/player.spec.ts. */
  canPlayQueue?: { waitForFlush(): Promise<void> };
}

export interface StudioState {
  source: ResolvedSource | null;
  player: PlayerState;
  frames: FrameEntry[];
  boxes: Box[];
  tracks: Track[];
  notes: Note[];
  chapters: Chapter[];
  /** The most recent `detect_scenes` result (Task 8), independent of `chapters` -- populated on
   * every call regardless of `addChapters`, so Markers.tsx can show scene boundaries the moment
   * they're detected even when the agent didn't choose to commit them as chapters. */
  scenes: Scene[];
  /** The most recent `search_frames` result (Task 8), for the Vision panel's click-to-seek hit
   * list -- `null` before any search has run this session. Replaced wholesale by each new search;
   * not persisted across a reload (same convention as `scenes`). */
  visionSearch: { query: string; ranges: { start: number; end: number; score: number }[] } | null;
  /** Task 12's VLM/Florence-2 results (describe_frame/describe_range/ask_about_frame/
   * dense_captions), for the Vision panel's own results list ("Add as note"/"Add as chapter
   * title"). `read_text`/`ground_phrase` add boxes instead (like detect_objects), not an entry
   * here -- their own text lives on the box's `label`. Session-only, not persisted (same
   * convention as `scenes`/`visionSearch`). */
  vision: VisionResult[];
  /** The in-progress text of a running describe_frame/describe_range/ask_about_frame call, updated
   * token-by-token (Task 12's "the Vision panel streams tokens" Key Decision) -- `null` when
   * nothing is generating. Cleared the moment the call finishes and its final `VisionResult` is
   * added, so a viewer never sees stale streaming text alongside the real, committed result. */
  visionStreaming: string | null;
  transcript: { segments: TranscriptSegment[]; lang: string | null };
  clips: Clip[];
  activity: ToolCall[];
  ui: UiState;
  capabilities: Capabilities;
  storage: StorageState;
  /** Keyed by ml/catalog.ts model id. Absent entries are treated as `{cached:false,loaded:false,
   * progress:0}` (never checked) -- see ml/client.ts's `getModelState`. */
  models: Record<string, ModelState>;
  /** Whether Stage/BoxDrawLayer.tsx is currently capturing drag gestures to draw a manual box.
   * Off by default so drawing doesn't hijack the paused-state clicks Chrome/PlayOverlay need
   * (scrubbing, pressing play); the Tracking panel's "Draw box" button toggles it. */
  boxDrawMode: boolean;
  /** Whether Stage/SegmentClickLayer.tsx is currently capturing a single click to run `segment`
   * at that point -- the Tracking panel's "Segment" button toggles it, same on/off convention as
   * boxDrawMode just above (mutually exclusive in the UI, not enforced here). */
  segmentClickMode: boolean;
  /** The most recent `detect_pose` call's first detected person's 33 landmarks (normalized
   * [0,1] + z + visibility), or `null` once nothing has been detected yet -- Stage/PoseOverlay.tsx
   * reads this reactively to draw the skeleton, the same way BoxOverlay reads `boxes`. */
  poseLandmarks: { x: number; y: number; z: number; visibility: number }[] | null;
  /** Task 13: applied `remove_background` calls, shown as chips on their clip and used by the
   * stage preview toggle and export.ts's own `video.process(sample)` compositing pass. */
  effects: Effect[];
  /** Task 13: `generate_voiceover` clips, drawn on the timeline by Timeline/VoiceoverClips.tsx and
   * mixed into exports (media/audioMix.ts) when any exist. */
  voiceovers: Voiceover[];

  setSource(source: ResolvedSource | null): void;
  /** Patches the current source's `thumbnailsVttUrl` in place, so a locally-generated sprite
   * (generate_thumbnails, Task 5) feeds the Timeline hover exactly like a sample's pre-supplied
   * VTT does (Task 3) -- Timeline.tsx reads only `source?.thumbnailsVttUrl`, unaware of which. */
  setSourceThumbnailsVtt(url: string): void;
  /** Patches the current source's `thumbnailsSpriteUrl`/`thumbnailsTimestamps` in place (Task 5's
   * `generate_thumbnails`), so VideoStage can render the real Filmstrip strip for a local/URL
   * source from the same sprite the Timeline hover preview already uses. */
  setSourceThumbnailsSprite(url: string, timestamps: number[]): void;

  addFrame(input: Omit<FrameEntry, 'id'>): string;
  removeFrame(id: string): void;
  /** Wholesale-replaces `frames` -- used to restore the Frames tray on boot from Dexie (each
   * entry's `blobUrl` freshly re-created there, since object URLs don't survive a reload) and by
   * `import_project` (Task 9). */
  setFrames(frames: FrameEntry[]): void;

  setCurrentTime(t: number): void;
  setDuration(d: number): void;
  setPaused(p: boolean): void;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  setRate(r: number): void;
  setLoop(loop: { start: number; end: number } | null): void;
  setFps(fps: number): void;
  setDimensions(width: number, height: number): void;

  addNote(input: Omit<Note, 'id' | 'createdAt'>): string;
  updateNote(id: string, patch: Partial<Note>): void;
  removeNote(id: string): void;
  /** Wholesale-replaces `notes` -- used to restore a persisted project on boot and by
   * `import_project` (Task 9); not used by ordinary add/update/remove call sites. */
  setNotes(notes: Note[]): void;

  addChapter(input: Omit<Chapter, 'id'>): string;
  updateChapter(id: string, patch: Partial<Chapter>): void;
  removeChapter(id: string): void;
  /** Wholesale-replaces `chapters` -- same project-restore/import use as `setNotes`. */
  setChapters(chapters: Chapter[]): void;

  /** Replaces the whole `scenes` slice (`detect_scenes`'s own result, Task 8). */
  setScenes(scenes: Scene[]): void;
  /** Replaces the whole `visionSearch` slice (`search_frames`'s own result, Task 8). */
  setVisionSearch(result: StudioState['visionSearch']): void;
  /** Appends one VLM/Florence-2 text result (Task 12). */
  addVisionResult(input: Omit<VisionResult, 'id'>): string;
  setVisionStreaming(text: string | null): void;

  addBox(input: Omit<Box, 'id'>): string;
  updateBox(id: string, patch: Partial<Box>): void;
  removeBox(id: string): void;
  clearBoxes(): void;
  /** Wholesale-replaces `boxes` -- same project-restore/import use as `setNotes`. */
  setBoxes(boxes: Box[]): void;

  addTrack(input: Omit<Track, 'id'>): string;
  /** Appends one keyframe to an existing track (the `track` tool's per-step result) rather than
   * replacing the whole `keyframes` array, so a long-running job can persist progress
   * incrementally instead of holding every keyframe in a closure until it finishes. */
  appendTrackKeyframe(id: string, keyframe: Track['keyframes'][number]): void;
  removeTrack(id: string): void;
  /** Wholesale-replaces `tracks` -- same project-restore/import use as `setNotes`. */
  setTracks(tracks: Track[]): void;

  setModelState(id: string, patch: Partial<ModelState>): void;
  setBoxDrawMode(on: boolean): void;
  setSegmentClickMode(on: boolean): void;
  setPoseLandmarks(landmarks: StudioState['poseLandmarks']): void;

  addEffect(input: Omit<Effect, 'id'>): string;
  removeEffect(id: string): void;
  /** Wholesale-replaces `effects` -- same project-restore/import use as `setNotes`. */
  setEffects(effects: Effect[]): void;

  addVoiceover(input: Omit<Voiceover, 'id'>): string;
  removeVoiceover(id: string): void;
  /** Wholesale-replaces `voiceovers` -- same project-restore/import use as `setNotes`. */
  setVoiceovers(voiceovers: Voiceover[]): void;

  /** Replaces the whole in-memory transcript for `lang` (`null` = the original). `transcribe`
   * (agent/tools/transcript.ts) reads the existing segments first and merges a re-transcribed
   * range in before calling this, so a full replace here is always the right semantics. */
  setTranscript(segments: TranscriptSegment[], lang: string | null): void;

  addClip(input: Omit<Clip, 'id'>): string;
  removeClip(id: string): void;
  reorderClips(order: string[]): void;
  /** Wholesale-replaces `clips` -- same project-restore/import use as `setNotes`. */
  setClips(clips: Clip[]): void;

  pushActivity(call: Omit<ToolCall, 'endedAt' | 'result' | 'error'>): void;
  updateActivity(id: string, patch: Partial<ToolCall>): void;

  setView(panel: PanelId, layout?: UiState['layout']): void;
  setTheme(theme: ThemeSetting): void;
  setAgentTransport(transport: AgentTransport): void;
  setAgentInstanceActive(active: boolean): void;

  setStorageState(patch: Partial<StorageState>): void;

  /** Registers/unregisters the live player instance. Called by VideoStage on mount/unmount. */
  registerPlayer(handle: PlayerHandle | null): void;
  play(): Promise<void>;
  pause(): void;
  togglePlay(): Promise<void>;
  /** Sets currentTime and resolves once the player actually reports the seek as complete. */
  seek(time: number, opts?: { signal?: AbortSignal }): Promise<void>;
  setPlayerVolume(v: number): void;
  setPlayerMuted(m: boolean): void;
  setPlayerRate(r: number): void;
  /** Steps by `count` frames (may be negative) at the store's current fps while paused. */
  stepFrames(count: number): Promise<void>;
}

const ACTIVITY_LIMIT = 200;
/** Upper bound on how long seek() waits for a "seeked" event before resolving anyway -- see the
 * comment at its call site (vidstack's YouTube provider does not reliably dispatch it). */
const SEEK_FALLBACK_MS = 1500;

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export type StudioStore = ReturnType<typeof createStudioStore>;

export function createStudioStore() {
  // Kept outside zustand state: a mutable library handle is not serializable/comparable state,
  // and each store instance gets its own closure-scoped handle (important for test isolation).
  let playerHandle: PlayerHandle | null = null;

  return createVanillaStore<StudioState>()((set, get) => ({
    source: null,
    player: {
      currentTime: 0,
      duration: 0,
      paused: true,
      volume: 1,
      muted: false,
      rate: 1,
      loop: null,
      fps: 30,
      width: 0,
      height: 0,
    },
    frames: [],
    boxes: [],
    tracks: [],
    notes: [],
    chapters: [],
    scenes: [],
    visionSearch: null,
    vision: [],
    visionStreaming: null,
    transcript: { segments: [], lang: null },
    clips: [],
    activity: [],
    ui: { theme: 'system', panel: 'library', layout: 'studio', agentTransport: 'none', agentInstanceActive: true },
    capabilities: detectCapabilities(),
    storage: { persisted: false, usage: 0, quota: 0, worksInThisContext: true },
    models: {},
    boxDrawMode: false,
    segmentClickMode: false,
    poseLandmarks: null,
    effects: [],
    voiceovers: [],

    setSource(asset) {
      set({ source: asset });
    },
    setSourceThumbnailsVtt(url) {
      set((s) => (s.source ? { source: { ...s.source, thumbnailsVttUrl: url } } : s));
    },
    setSourceThumbnailsSprite(url, timestamps) {
      set((s) => (s.source ? { source: { ...s.source, thumbnailsSpriteUrl: url, thumbnailsTimestamps: timestamps } } : s));
    },

    addFrame(input) {
      const id = nextId('frame');
      set((s) => ({ frames: [...s.frames, { ...input, id }] }));
      return id;
    },
    removeFrame(id) {
      set((s) => {
        const removed = s.frames.find((f) => f.id === id);
        if (removed) URL.revokeObjectURL(removed.blobUrl);
        return { frames: s.frames.filter((f) => f.id !== id) };
      });
    },
    setFrames(frames) {
      set({ frames });
    },

    setCurrentTime(t) {
      set((s) => ({ player: { ...s.player, currentTime: t } }));
    },
    setDuration(d) {
      set((s) => ({ player: { ...s.player, duration: d } }));
    },
    setPaused(p) {
      set((s) => ({ player: { ...s.player, paused: p } }));
    },
    setVolume(v) {
      set((s) => ({ player: { ...s.player, volume: v } }));
    },
    setMuted(m) {
      set((s) => ({ player: { ...s.player, muted: m } }));
    },
    setRate(r) {
      set((s) => ({ player: { ...s.player, rate: r } }));
    },
    setLoop(loop) {
      set((s) => ({ player: { ...s.player, loop } }));
    },
    setFps(fps) {
      set((s) => ({ player: { ...s.player, fps } }));
    },
    setDimensions(width, height) {
      set((s) => ({ player: { ...s.player, width, height } }));
    },

    addNote(input) {
      const id = nextId('note');
      const note: Note = { ...input, id, createdAt: Date.now() };
      set((s) => ({ notes: [...s.notes, note].sort((a, b) => a.time - b.time) }));
      return id;
    },
    updateNote(id, patch) {
      set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
    },
    removeNote(id) {
      set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
    },
    setNotes(notes) {
      set({ notes });
    },

    addChapter(input) {
      const overlap = get().chapters.some((c) => rangesOverlap(input.start, input.end, c.start, c.end));
      if (overlap) {
        throw new Error('chapter_overlap: overlaps an existing chapter');
      }
      const id = nextId('chapter');
      const chapter: Chapter = { ...input, id };
      set((s) => ({ chapters: [...s.chapters, chapter].sort((a, b) => a.start - b.start) }));
      return id;
    },
    updateChapter(id, patch) {
      set((s) => ({ chapters: s.chapters.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
    },
    removeChapter(id) {
      set((s) => ({ chapters: s.chapters.filter((c) => c.id !== id) }));
    },
    setChapters(chapters) {
      set({ chapters });
    },

    setScenes(scenes) {
      set({ scenes });
    },
    setVisionSearch(result) {
      set({ visionSearch: result });
    },
    addVisionResult(input) {
      const id = nextId('vision');
      set((s) => ({ vision: [...s.vision, { ...input, id }] }));
      return id;
    },
    setVisionStreaming(text) {
      set({ visionStreaming: text });
    },

    addBox(input) {
      const id = nextId('box');
      const box: Box = { ...input, id };
      set((s) => ({ boxes: [...s.boxes, box] }));
      return id;
    },
    updateBox(id, patch) {
      set((s) => ({ boxes: s.boxes.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
    },
    removeBox(id) {
      set((s) => ({ boxes: s.boxes.filter((b) => b.id !== id) }));
    },
    clearBoxes() {
      set({ boxes: [] });
    },
    setBoxes(boxes) {
      set({ boxes });
    },

    addTrack(input) {
      const id = nextId('track');
      const track: Track = { ...input, id };
      set((s) => ({ tracks: [...s.tracks, track] }));
      return id;
    },
    appendTrackKeyframe(id, keyframe) {
      set((s) => ({
        tracks: s.tracks.map((t) => (t.id === id ? { ...t, keyframes: [...t.keyframes, keyframe] } : t)),
      }));
    },
    removeTrack(id) {
      set((s) => ({ tracks: s.tracks.filter((t) => t.id !== id) }));
    },
    setTracks(tracks) {
      set({ tracks });
    },

    setModelState(id, patch) {
      set((s) => ({ models: { ...s.models, [id]: { cached: false, loaded: false, progress: 0, ...s.models[id], ...patch } } }));
    },
    setTranscript(segments, lang) {
      set({ transcript: { segments, lang } });
    },
    setBoxDrawMode(on) {
      set({ boxDrawMode: on });
    },
    setSegmentClickMode(on) {
      set({ segmentClickMode: on });
    },
    setPoseLandmarks(landmarks) {
      set({ poseLandmarks: landmarks });
    },

    addEffect(input) {
      const id = nextId('effect');
      set((s) => ({ effects: [...s.effects, { ...input, id }] }));
      return id;
    },
    removeEffect(id) {
      set((s) => ({ effects: s.effects.filter((e) => e.id !== id) }));
    },
    setEffects(effects) {
      set({ effects });
    },

    addVoiceover(input) {
      const id = nextId('voiceover');
      set((s) => ({ voiceovers: [...s.voiceovers, { ...input, id }] }));
      return id;
    },
    removeVoiceover(id) {
      set((s) => ({ voiceovers: s.voiceovers.filter((v) => v.id !== id) }));
    },
    setVoiceovers(voiceovers) {
      set({ voiceovers });
    },

    addClip(input) {
      const id = nextId('clip');
      const clip: Clip = { ...input, id };
      set((s) => ({ clips: [...s.clips, clip].sort((a, b) => a.order - b.order) }));
      return id;
    },
    removeClip(id) {
      set((s) => ({ clips: s.clips.filter((c) => c.id !== id) }));
    },
    reorderClips(order) {
      set((s) => {
        const byId = new Map(s.clips.map((c) => [c.id, c]));
        const reordered = order
          .map((id, index) => {
            const clip = byId.get(id);
            return clip ? { ...clip, order: index } : null;
          })
          .filter((c): c is Clip => c !== null);
        return { clips: reordered };
      });
    },
    setClips(clips) {
      set({ clips });
    },

    pushActivity(call) {
      set((s) => {
        const next = [...s.activity, call as ToolCall];
        return { activity: next.length > ACTIVITY_LIMIT ? next.slice(next.length - ACTIVITY_LIMIT) : next };
      });
    },
    updateActivity(id, patch) {
      set((s) => ({ activity: s.activity.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
    },

    setView(panel, layout) {
      set((s) => ({ ui: { ...s.ui, panel, layout: layout ?? s.ui.layout } }));
    },
    setTheme(theme) {
      set((s) => ({ ui: { ...s.ui, theme } }));
    },
    setAgentTransport(transport) {
      set((s) => ({ ui: { ...s.ui, agentTransport: transport } }));
    },
    setAgentInstanceActive(active) {
      set((s) => ({ ui: { ...s.ui, agentInstanceActive: active } }));
    },

    setStorageState(patch) {
      set((s) => ({ storage: { ...s.storage, ...patch } }));
    },

    registerPlayer(handle) {
      playerHandle = handle;
    },
    async play() {
      await playerHandle?.canPlayQueue?.waitForFlush();
      await playerHandle?.play();
    },
    pause() {
      playerHandle?.pause();
    },
    async togglePlay() {
      if (!playerHandle) return;
      if (playerHandle.paused) {
        await playerHandle.canPlayQueue?.waitForFlush();
        await playerHandle.play();
      } else {
        playerHandle.pause();
      }
    },
    async seek(time, opts) {
      const handle = playerHandle;
      if (!handle) {
        set((s) => ({ player: { ...s.player, currentTime: Math.max(0, time) } }));
        return;
      }
      const clamped = Math.max(0, Math.min(time, get().player.duration || time));
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          handle.removeEventListener('seeked', onSeeked);
          opts?.signal?.removeEventListener('abort', onAbort);
          clearTimeout(timeoutId);
          resolve();
        };
        const onSeeked = (): void => finish();
        const onAbort = (): void => finish();
        // vidstack's YouTube provider does not reliably dispatch `seeked` (confirmed live: the
        // iframe API applies the seek -- currentTime updates -- but no event follows), which
        // would otherwise hang this promise, and by extension any playback tool built on it,
        // forever. SEEK_FALLBACK_MS bounds the wait so a call always settles.
        const timeoutId = setTimeout(finish, SEEK_FALLBACK_MS);
        handle.addEventListener('seeked', onSeeked, { once: true });
        opts?.signal?.addEventListener('abort', onAbort, { once: true });
        handle.currentTime = clamped;
      });
    },
    setPlayerVolume(v) {
      if (playerHandle) playerHandle.volume = v;
      set((s) => ({ player: { ...s.player, volume: v } }));
    },
    setPlayerMuted(m) {
      if (playerHandle) playerHandle.muted = m;
      set((s) => ({ player: { ...s.player, muted: m } }));
    },
    setPlayerRate(r) {
      if (playerHandle) playerHandle.playbackRate = r;
      set((s) => ({ player: { ...s.player, rate: r } }));
    },
    async stepFrames(count) {
      const { currentTime, fps } = get().player;
      const delta = count / (fps || 30);
      await get().seek(currentTime + delta);
    },
  }));
}

export const studioStore = createStudioStore();

export function useStudio<T>(selector: (state: StudioState) => T): T {
  return useStore(studioStore, selector);
}
