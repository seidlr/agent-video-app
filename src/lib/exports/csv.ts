import type { ExportContext } from './types';

type CsvRow = [type: string, start: number, end: number | '', label: string, tags: string];

/** Quotes a field only when it needs it (contains a comma, quote, or newline) -- RFC 4180, and
 * matches what a spreadsheet actually expects on import rather than quoting everything. */
function csvField(value: string | number): string {
  const s = String(value);
  if (!/[",\n]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

function row(fields: CsvRow): string {
  return fields.map(csvField).join(',');
}

/** `type,start,end,label,tags` -- one row per chapter/note/box, in that order, each sorted by its
 * own start time, per the plan's Task 6 Key Decisions. Times are plain seconds (not a timecode
 * string): a spreadsheet sorts and computes on numbers, not on "MM:SS.mmm" text. `end` is blank
 * for a point note or a box with no `until` -- there is no meaningful end to report, and a copied
 * start value would misrepresent the record as a range. */
export function exportCsv(ctx: ExportContext): string {
  const rows: CsvRow[] = [
    ...[...ctx.chapters].sort((a, b) => a.start - b.start).map((c): CsvRow => ['chapter', c.start, c.end, c.title, '']),
    ...[...ctx.notes].sort((a, b) => a.time - b.time).map((n): CsvRow => ['note', n.time, n.end ?? '', n.text, n.tags.join('|')]),
    ...[...ctx.boxes].sort((a, b) => a.time - b.time).map((b): CsvRow => ['box', b.time, b.until ?? '', b.label, '']),
  ];
  const lines = ['type,start,end,label,tags', ...rows.map(row)];
  return `${lines.join('\n')}\n`;
}
