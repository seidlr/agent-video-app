// Shared domain types for Agent Video Studio. Kept dependency-free so both the main thread
// and workers (segment/detect/transcribe/...) can import from here without pulling in React
// or the store.

// Multi-project workspaces are out of scope (see the plan's Out of Scope / Deferred Ideas);
// everything lives under one fixed project id today.
export const DEFAULT_PROJECT_ID = 'default';

export type AssetKind = 'file' | 'url' | 'youtube' | 'sample';

export interface Asset {
  id: string;
  projectId: string;
  kind: AssetKind;
  name: string;
  opfsPath?: string;
  url?: string;
  youtubeId?: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  bytes: number;
  createdAt: number;
}

export interface Note {
  id: string;
  time: number;
  end?: number;
  text: string;
  tags: string[];
  createdBy: 'agent' | 'user';
  createdAt: number;
}

export interface Chapter {
  id: string;
  start: number;
  end: number;
  title: string;
}

export type BoxSource = 'agent' | 'manual' | 'detect' | 'segment' | 'track' | 'ocr' | 'ground';

export interface Box {
  id: string;
  time: number;
  until?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  source: BoxSource;
  trackId?: string;
  maskId?: string;
}

export interface TrackKeyframe {
  time: number;
  box: { x: number; y: number; w: number; h: number };
}

export interface Track {
  id: string;
  boxIds: string[];
  keyframes: TrackKeyframe[];
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words?: { start: number; end: number; text: string }[];
}

export interface Clip {
  id: string;
  start: number;
  end: number;
  name?: string;
  order: number;
}

export interface CapturedFrame {
  id: string;
  time: number;
  kind: 'frame' | 'depth' | 'contact-sheet' | 'upscaled';
  width: number;
  height: number;
  downloadedAs?: string;
  /** For `kind:'upscaled'`: the frame it was upscaled from, per the plan's own "source frame id
   * kept" Key Decision -- lets the Frames panel show "upscaled from <time>" instead of just a
   * bare badge. */
  sourceFrameId?: string;
}

export type ToolCallStatus = 'running' | 'done' | 'error';

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  via: 'webmcp' | 'bridge' | 'mcp-app' | 'mcp-bus' | 'testing';
  status: ToolCallStatus;
  startedAt: number;
  endedAt?: number;
  result?: unknown;
  error?: string;
}

export type MatteReplace = 'transparent' | 'color' | 'blur';

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface Effect {
  id: string;
  kind: 'matte';
  start: number;
  end: number;
  model: string;
  replace: MatteReplace;
  color?: RgbColor;
}

export interface Voiceover {
  id: string;
  at: number;
  durationSeconds: number;
  text: string;
  voice: string;
  blob: Blob;
}

export type JobStatus = 'running' | 'done' | 'failed' | 'cancelled';

export interface Job {
  jobId: string;
  tool: string;
  status: JobStatus;
  progress: number;
  message?: string;
  startedAt: number;
  endedAt?: number;
  result?: unknown;
  requestId?: string;
}
