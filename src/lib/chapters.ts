import { buildVttString, parseVtt } from './vtt';
import type { Chapter } from './types';

/**
 * Chapters live as an object model in the store (`Chapter{id,start,end,title}`); vidstack's
 * `TimeSlider.Chapters`/`<Track kind="chapters">` (Timeline.tsx/VideoStage.tsx) need a real VTT
 * text resource instead, so this is the one place the object model gets serialized back out, as a
 * `data:` URL (no Blob/object-URL lifecycle to manage across chapter edits).
 */
export function chaptersToVttDataUrl(chapters: Chapter[]): string {
  const vtt = buildVttString([...chapters].sort((a, b) => a.start - b.start).map((c) => ({ start: c.start, end: c.end, text: c.title })));
  return `data:text/vtt;charset=utf-8,${encodeURIComponent(vtt)}`;
}

export interface ParsedChapterInput {
  start: number;
  end: number;
  title: string;
}

/** Parses an imported/pasted chapters VTT into inputs ready for `store.addChapter` (no `id` yet
 * -- the store mints one). An untitled cue (blank payload) gets a placeholder title rather than
 * being silently dropped, since a chapter with no title is still a valid chapter boundary. */
export function parseChaptersVtt(content: string): ParsedChapterInput[] {
  return parseVtt(content).map((cue) => ({ start: cue.start, end: cue.end, title: cue.text || 'Untitled' }));
}
