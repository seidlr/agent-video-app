/**
 * Shared time parsing/formatting for every tool argument and every UI timestamp.
 * parseTime accepts what an agent or a human is likely to type: plain seconds, a timecode,
 * a relative offset from the current playhead, a percent of duration, or a frame number.
 */

export interface TimeContext {
  duration: number;
  currentTime: number;
  fps?: number;
}

const TIMECODE_RE = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/;

export function parseTime(input: string | number, ctx: TimeContext): number | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.max(0, input) : null;
  }

  const trimmed = input.trim();
  if (trimmed === '') return null;

  // Relative offset: "+5", "-2"
  if (/^[+-]\d+(?:\.\d+)?$/.test(trimmed)) {
    const delta = Number.parseFloat(trimmed);
    return Math.max(0, ctx.currentTime + delta);
  }

  // Percent of duration: "50%"
  if (/^\d+(?:\.\d+)?%$/.test(trimmed)) {
    const pct = Number.parseFloat(trimmed.slice(0, -1));
    return Math.max(0, (pct / 100) * ctx.duration);
  }

  // Frame number: "f30"
  if (/^[fF]\d+$/.test(trimmed)) {
    if (!ctx.fps || ctx.fps <= 0) return null;
    const frame = Number.parseInt(trimmed.slice(1), 10);
    return frameToTime(frame, ctx.fps);
  }

  // Timecode: "H:MM:SS.mmm" or "M:SS(.mmm)"
  const tc = TIMECODE_RE.exec(trimmed);
  if (tc) {
    const hours = tc[1] ? Number.parseInt(tc[1], 10) : 0;
    const minutes = Number.parseInt(tc[2] as string, 10);
    const seconds = Number.parseFloat(tc[3] as string);
    return Math.max(0, hours * 3600 + minutes * 60 + seconds);
  }

  // Plain seconds
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Number.parseFloat(trimmed));
  }

  return null;
}

function pad(n: number, width: number): string {
  return String(Math.floor(n)).padStart(width, '0');
}

function padMs(n: number): string {
  return String(Math.round(n)).padStart(3, '0');
}

/** HH:MM:SS.mmm — used everywhere a full timecode is shown or exported. */
export function formatTime(secs: number): string {
  const clamped = Math.max(0, secs);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${padMs(ms)}`;
}

/** MM:SS.mmm — the compact form used in chrome/timeline UI (minutes can exceed 59). */
export function secsToTimecode(secs: number): string {
  const clamped = Math.max(0, secs);
  const minutes = Math.floor(clamped / 60);
  const seconds = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${pad(minutes, 2)}:${pad(seconds, 2)}.${padMs(ms)}`;
}

export function frameToTime(frame: number, fps: number): number {
  if (fps <= 0) return 0;
  return frame / fps;
}
