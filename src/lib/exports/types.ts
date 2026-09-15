import type { Box, Chapter, Clip, Note, Track, TranscriptSegment } from '../types';

/** Shared input every export format function reads from -- the plan's own phrasing: "pure
 * functions over {asset, notes, chapters, boxes, transcript?}". `tracks`/`clips` are optional
 * (Task 7/Task 9 features) so exports.test.ts's Task 6 fixture doesn't need to invent them. */
export interface ExportContext {
  asset: { title: string };
  notes: Note[];
  chapters: Chapter[];
  boxes: Box[];
  tracks?: Track[];
  clips?: Clip[];
  transcript?: { segments: TranscriptSegment[]; lang: string | null };
  /** Frames per second, for EDL's frame-accurate timecodes. */
  fps: number;
}

export type ExportFormatId = 'markdown' | 'json' | 'vtt' | 'srt' | 'csv' | 'edl';
