import { buildVttString } from '../vtt';
import type { ExportContext } from './types';

/** A point note (no `end`) has no natural cue duration; VTT requires one, so it gets this fixed
 * span -- long enough to be visible if the file is loaded as a real subtitle track, short enough
 * not to overlap a note a couple of seconds later. */
const POINT_NOTE_CUE_SECONDS = 2;

function noteText(note: ExportContext['notes'][number]): string {
  const tags = note.tags.length > 0 ? ` ${note.tags.map((t) => `#${t}`).join(' ')}` : '';
  return `${note.text}${tags}`;
}

/** Notes as VTT cues, or (via `kind:'chapters'`) chapters as a second, equally valid VTT block --
 * per the plan's Task 6 Key Decisions ("notes as cues; chapters as a second block when
 * kind:'chapters'"). Both reuse lib/vtt.ts's buildVttString rather than reimplementing cue
 * formatting here. */
export function exportVtt(ctx: ExportContext, kind: 'notes' | 'chapters' = 'notes'): string {
  if (kind === 'chapters') {
    return buildVttString([...ctx.chapters].sort((a, b) => a.start - b.start).map((c) => ({ start: c.start, end: c.end, text: c.title })));
  }
  const cues = [...ctx.notes]
    .sort((a, b) => a.time - b.time)
    .map((n) => ({ start: n.time, end: n.end ?? n.time + POINT_NOTE_CUE_SECONDS, text: noteText(n) }));
  return buildVttString(cues);
}
