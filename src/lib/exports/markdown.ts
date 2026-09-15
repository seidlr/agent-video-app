import { secsToTimecode } from '../time';
import type { ExportContext } from './types';

function noteLine(note: ExportContext['notes'][number]): string {
  const time = note.end !== undefined ? `${secsToTimecode(note.time)} → ${secsToTimecode(note.end)}` : secsToTimecode(note.time);
  const tags = note.tags.length > 0 ? ` ${note.tags.map((t) => `#${t}`).join(' ')}` : '';
  return `- [${time}] ${note.text}${tags}`;
}

/** `# <title>`, `## Chapters`, `## Notes` (`- [MM:SS.mmm] text #tag`), `## Boxes`, and an optional
 * `## Transcript` when `ctx.transcript` has segments -- per the plan's Task 6 Key Decisions. A
 * section with nothing to show is omitted entirely rather than printed as an empty heading. */
export function exportMarkdown(ctx: ExportContext): string {
  const sections: string[] = [`# ${ctx.asset.title}`];

  if (ctx.chapters.length > 0) {
    const lines = ctx.chapters.map((c) => `- [${secsToTimecode(c.start)} → ${secsToTimecode(c.end)}] ${c.title}`);
    sections.push(`## Chapters\n\n${lines.join('\n')}`);
  }

  if (ctx.notes.length > 0) {
    sections.push(`## Notes\n\n${ctx.notes.map(noteLine).join('\n')}`);
  }

  if (ctx.boxes.length > 0) {
    const lines = ctx.boxes.map((b) => `- [${secsToTimecode(b.time)}] ${b.label}`);
    sections.push(`## Boxes\n\n${lines.join('\n')}`);
  }

  if (ctx.transcript && ctx.transcript.segments.length > 0) {
    const lines = ctx.transcript.segments.map((s) => `- [${secsToTimecode(s.start)} → ${secsToTimecode(s.end)}] ${s.text}`);
    sections.push(`## Transcript\n\n${lines.join('\n')}`);
  }

  return `${sections.join('\n\n')}\n`;
}
