import { createStore as createVanillaStore } from 'zustand/vanilla';
import { useStore } from 'zustand/react';
import { detectCapabilities, type Capabilities } from '../lib/capabilities';
import type { Asset, Box, Chapter, Clip, Note, ToolCall, Track, TranscriptSegment } from '../lib/types';

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
}

export interface StorageState {
  persisted: boolean;
  usage: number;
  quota: number;
}

export interface StudioState {
  source: Asset | null;
  player: PlayerState;
  frames: { id: string; time: number; kind: string }[];
  boxes: Box[];
  tracks: Track[];
  notes: Note[];
  chapters: Chapter[];
  transcript: { segments: TranscriptSegment[]; lang: string | null };
  clips: Clip[];
  activity: ToolCall[];
  ui: UiState;
  capabilities: Capabilities;
  storage: StorageState;

  setSource(asset: Asset | null): void;

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

  addChapter(input: Omit<Chapter, 'id'>): string;
  updateChapter(id: string, patch: Partial<Chapter>): void;
  removeChapter(id: string): void;

  addBox(input: Omit<Box, 'id'>): string;
  updateBox(id: string, patch: Partial<Box>): void;
  removeBox(id: string): void;
  clearBoxes(): void;

  addClip(input: Omit<Clip, 'id'>): string;
  removeClip(id: string): void;
  reorderClips(order: string[]): void;

  pushActivity(call: Omit<ToolCall, 'endedAt' | 'result' | 'error'>): void;
  updateActivity(id: string, patch: Partial<ToolCall>): void;

  setView(panel: PanelId, layout?: UiState['layout']): void;
  setTheme(theme: ThemeSetting): void;
  setAgentTransport(transport: AgentTransport): void;

  setStorageState(patch: Partial<StorageState>): void;
}

const ACTIVITY_LIMIT = 200;

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
    transcript: { segments: [], lang: null },
    clips: [],
    activity: [],
    ui: { theme: 'system', panel: 'activity', layout: 'studio', agentTransport: 'none' },
    capabilities: detectCapabilities(),
    storage: { persisted: false, usage: 0, quota: 0 },

    setSource(asset) {
      set({ source: asset });
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

    setStorageState(patch) {
      set((s) => ({ storage: { ...s.storage, ...patch } }));
    },
  }));
}

export const studioStore = createStudioStore();

export function useStudio<T>(selector: (state: StudioState) => T): T {
  return useStore(studioStore, selector);
}
