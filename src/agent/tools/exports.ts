import { EXPORT_FORMATS } from '../../lib/exports';
import type { ExportFormatId } from '../../lib/exports';
import { DEFAULT_PROJECT_ID } from '../../lib/types';
import { buildProjectZip } from '../../media/project';
import { db } from '../../store/db';
import type { StudioStore } from '../../store/studio';
import type { Registry, ToolResult } from '../registry';

/** `<a download>` click, no picker -- same pattern as tools/frames.ts's triggerDownload, but for
 * a plain-text Blob instead of an image one. */
function triggerDownload(text: string, filename: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Same as above, for an already-built binary Blob (the zip) rather than text needing its own
 * encoding -- same split tools/frames.ts's own two triggerDownload variants already establish. */
function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** export tools: export_notes. `always` -- exporting is pure text generation over already-loaded
 * state, no decode/pixel access needed. */
export function defineExportsTools(registry: Registry, store: StudioStore): void {
  registry.define<{ format: ExportFormatId; download?: boolean; copyToClipboard?: boolean }>({
    name: 'export_notes',
    description:
      'Exports notes/chapters/boxes as markdown, json, vtt, srt, csv, or edl text. The full text is always in the result -- download/copyToClipboard are optional extra delivery channels for a host with file access or clipboard access instead of (or in addition to) reading the JSON result.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['markdown', 'json', 'vtt', 'srt', 'csv', 'edl'] },
        download: { type: 'boolean' },
        copyToClipboard: { type: 'boolean' },
      },
      required: ['format'],
    },
    group: 'export',
    when: 'always',
    handler: async (args): Promise<ToolResult> => {
      const def = EXPORT_FORMATS[args.format];
      if (!def) return { ok: false, error: 'invalid_format', hint: 'format must be one of markdown|json|vtt|srt|csv|edl' };

      const state = store.getState();
      const title = state.source?.title ?? 'video';
      const text = def.generate({
        asset: { title },
        notes: state.notes,
        chapters: state.chapters,
        boxes: state.boxes,
        tracks: state.tracks,
        clips: state.clips,
        transcript: state.transcript,
        fps: state.player.fps || 30,
      });

      const filename = `${title}-notes.${def.extension}`;
      let downloadedAs: string | undefined;
      if (args.download) {
        triggerDownload(text, filename, def.mimeType);
        downloadedAs = filename;
      }

      let clipboard: 'copied' | 'unavailable' | undefined;
      if (args.copyToClipboard) {
        try {
          await navigator.clipboard.writeText(text);
          clipboard = 'copied';
        } catch {
          clipboard = 'unavailable';
        }
      }

      return {
        ok: true,
        summary: `Exported ${args.format}${downloadedAs ? `, saved to Downloads as ${downloadedAs}` : ''}${clipboard === 'copied' ? ', copied to clipboard' : ''}`,
        text,
        downloadedAs,
        clipboard,
      };
    },
  });

  registry.define<{ download?: boolean }>({
    name: 'export_project',
    description:
      'Exports the current project (notes, chapters, boxes, tracks, clips, captured frames, and a transcript if one exists) as a .zip -- notes.md and a project.json alongside frames/*.png. Re-import it via the Library panel\'s "Import project" button. Metadata only for now: the source video itself is not bundled.',
    inputSchema: { type: 'object', properties: { download: { type: 'boolean' } } },
    group: 'export',
    when: 'always',
    handler: async (args): Promise<ToolResult> => {
      const state = store.getState();
      const frameRows = await db.frames.where('projectId').equals(DEFAULT_PROJECT_ID).toArray();

      const zipBlob = await buildProjectZip({
        ctx: {
          asset: { title: state.source?.title ?? 'video' },
          notes: state.notes,
          chapters: state.chapters,
          boxes: state.boxes,
          tracks: state.tracks,
          clips: state.clips,
          transcript: state.transcript,
          fps: state.player.fps || 30,
        },
        frames: frameRows.map((r) => ({ id: r.id, time: r.time, kind: r.kind, width: r.width, height: r.height, downloadedAs: r.downloadedAs, blob: r.blob })),
      });

      const title = state.source?.title ?? 'video';
      const filename = `${title}-project.zip`;
      let downloadedAs: string | undefined;
      if (args.download !== false) {
        triggerBlobDownload(zipBlob, filename);
        downloadedAs = filename;
      }

      return {
        ok: true,
        summary: `Exported project (${state.notes.length} note(s), ${state.chapters.length} chapter(s), ${state.boxes.length} box(es), ${state.clips.length} clip(s), ${frameRows.length} frame(s))${downloadedAs ? `, saved to Downloads as ${downloadedAs}` : ''}`,
        bytes: zipBlob.size,
        downloadedAs,
      };
    },
  });
}
