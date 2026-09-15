import type { ExportContext } from './types';

const POINT_NOTE_CUE_SECONDS = 2;

/** SubRip's own timestamp format: HH:MM:SS,mmm -- a comma, not the dot every other format in this
 * app uses (lib/time.ts's formatTime/secsToTimecode), because that comma is SRT's actual on-disk
 * contract, not a stylistic choice. */
function toSrtTimestamp(secs: number): string {
  const clamped = Math.max(0, secs);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  const pad = (n: number, width: number): string => String(n).padStart(width, '0');
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(ms, 3)}`;
}

function noteText(note: ExportContext['notes'][number]): string {
  const tags = note.tags.length > 0 ? ` ${note.tags.map((t) => `#${t}`).join(' ')}` : '';
  return `${note.text}${tags}`;
}

/** Notes only, numbered sequentially from 1, HH:MM:SS,mmm -- per the plan's Task 6 Key Decisions.
 * A point note (no `end`) gets the same fixed 2s cue span as export_notes's VTT format, for the
 * same reason: SRT cues need a duration, and consistency between the two subtitle-shaped formats
 * matters more than either duration being individually meaningful. */
export function exportSrt(ctx: ExportContext): string {
  const sorted = [...ctx.notes].sort((a, b) => a.time - b.time);
  const blocks = sorted.map((note, index) => {
    const end = note.end ?? note.time + POINT_NOTE_CUE_SECONDS;
    return `${index + 1}\n${toSrtTimestamp(note.time)} --> ${toSrtTimestamp(end)}\n${noteText(note)}`;
  });
  return blocks.length > 0 ? `${blocks.join('\n\n')}\n` : '';
}
