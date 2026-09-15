import { exportCsv } from './csv';
import { exportEdl } from './edl';
import { exportJson } from './json';
import { exportMarkdown } from './markdown';
import { exportSrt } from './srt';
import { exportVtt } from './vtt';
import type { ExportContext, ExportFormatId } from './types';

export type { ExportContext, ExportFormatId } from './types';
export { secondsToEdlTimecode } from './edl';

export interface ExportFormatDef {
  id: ExportFormatId;
  extension: string;
  mimeType: string;
  generate(ctx: ExportContext): string;
}

/** One registry entry per format id, each wrapping its pure generate() from the sibling module --
 * agent/tools/exports.ts's export_notes tool (and the Notes panel's export menu) both key off
 * this instead of a per-format switch statement, so a new format only needs adding here. */
export const EXPORT_FORMATS: Record<ExportFormatId, ExportFormatDef> = {
  markdown: { id: 'markdown', extension: 'md', mimeType: 'text/markdown', generate: exportMarkdown },
  json: { id: 'json', extension: 'json', mimeType: 'application/json', generate: exportJson },
  vtt: { id: 'vtt', extension: 'vtt', mimeType: 'text/vtt', generate: (ctx) => exportVtt(ctx, 'notes') },
  srt: { id: 'srt', extension: 'srt', mimeType: 'application/x-subrip', generate: exportSrt },
  csv: { id: 'csv', extension: 'csv', mimeType: 'text/csv', generate: exportCsv },
  edl: { id: 'edl', extension: 'edl', mimeType: 'text/plain', generate: exportEdl },
};
