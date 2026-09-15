import { EXPORT_FORMATS } from '../../lib/exports';
import type { ExportFormatId } from '../../lib/exports';
import { DEFAULT_PROJECT_ID } from '../../lib/types';
import { parseTime } from '../../lib/time';
import { exportVideoClips } from '../../media/export';
import { exportGif } from '../../media/gif';
import { getInput } from '../../media/input';
import { buildProjectZip } from '../../media/project';
import { db } from '../../store/db';
import type { StudioStore } from '../../store/studio';
import type { Registry, ToolResult } from '../registry';

/** The fixed download base name TS-007 step 2 tests verbatim ("agent-video-studio-export.mp4"),
 * reused for export_gif too for the same-convention reason `export_project` uses the source's own
 * title instead: unlike a project zip (one per video, naturally named after it), a clip export is
 * a new, separate artifact that may combine multiple clips or none of the original title's
 * context, so a fixed product-name base is what the plan's own DoD expects here. */
const EXPORT_BASENAME = 'agent-video-studio-export';

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

  registry.define<{ clips: 'all' | string[]; format?: 'mp4' | 'webm'; width?: number; burnOverlays?: boolean; download?: boolean }>({
    name: 'export_video',
    description:
      'Trims and concatenates clips (added via add_clip) into a single mp4/webm file, optionally burning box overlays into the video. First call may take a while for long clips -- this is a job-mode tool; poll with get_job if it does not finish inline.',
    inputSchema: {
      type: 'object',
      properties: {
        // The hand-rolled validator (agent/validate.ts) has no oneOf/anyOf, and combining `enum`
        // with `items` on one dual-typed property breaks the array case (enum.includes() on an
        // array value never matches by reference) -- so only the coarse string|array shape is
        // schema-checked; the handler below rejects a string value that isn't literally "all".
        clips: { type: ['string', 'array'], items: { type: 'string' } },
        format: { type: 'string', enum: ['mp4', 'webm'] },
        width: { type: 'number', minimum: 16 },
        burnOverlays: { type: 'boolean' },
        download: { type: 'boolean' },
      },
      required: ['clips'],
    },
    annotations: { consequentialHint: true },
    group: 'export',
    when: 'local',
    mode: 'job',
    handler: async (args, ctx): Promise<ToolResult> => {
      const state = store.getState();
      if (!state.source) return { ok: false, error: 'no_video_loaded' };
      if (state.source.kind === 'youtube') {
        return { ok: false, error: 'export_unavailable_on_youtube', hint: 'Needs direct pixel/byte access; not available for a YouTube source.' };
      }
      if (typeof args.clips === 'string' && args.clips !== 'all') {
        return { ok: false, error: 'invalid_clips', hint: '`clips` must be "all" or an array of clip ids.' };
      }

      const sortedClips = [...state.clips].sort((a, b) => a.order - b.order);
      const selected = args.clips === 'all' ? sortedClips : sortedClips.filter((c) => args.clips.includes(c.id));
      if (selected.length === 0) return { ok: false, error: 'no_clips', hint: 'Add at least one clip with add_clip first.' };

      try {
        const input = await getInput(state.source);
        const result = await exportVideoClips(input, {
          clips: selected.map((c) => ({ start: c.start, end: c.end })),
          width: args.width,
          format: args.format,
          burnOverlays: args.burnOverlays,
          boxes: state.boxes,
          onProgress: (fraction) => ctx.progress(fraction),
        });

        const filename = `${EXPORT_BASENAME}.${args.format === 'webm' ? 'webm' : 'mp4'}`;
        let downloadedAs: string | undefined;
        if (args.download !== false) {
          triggerBlobDownload(result.blob, filename);
          downloadedAs = filename;
        }

        return {
          ok: true,
          summary: `Exported ${selected.length} clip(s), ${result.durationSeconds.toFixed(1)}s, ${result.width}x${result.height}${downloadedAs ? `, saved to Downloads as ${downloadedAs}` : ''}`,
          durationSeconds: result.durationSeconds,
          width: result.width,
          height: result.height,
          codec: result.codec,
          bytes: result.blob.size,
          downloadedAs,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const [code] = message.split(':');
        return { ok: false, error: code || 'export_failed', hint: message };
      }
    },
  });

  registry.define<{ start: string | number; end: string | number; width?: number; fps?: number; download?: boolean }>({
    name: 'export_gif',
    description: 'Exports a time range as a GIF (default 320px wide, 10fps). Capped at 300 frames -- fails with too_many_frames if the range/fps combination would exceed that.',
    inputSchema: {
      type: 'object',
      properties: {
        start: { type: ['string', 'number'] },
        end: { type: ['string', 'number'] },
        width: { type: 'number', minimum: 16 },
        fps: { type: 'number', minimum: 1, maximum: 30 },
        download: { type: 'boolean' },
      },
      required: ['start', 'end'],
    },
    group: 'export',
    when: 'local',
    mode: 'job',
    handler: async (args, ctx): Promise<ToolResult> => {
      const state = store.getState();
      if (!state.source) return { ok: false, error: 'no_video_loaded' };
      if (state.source.kind === 'youtube') {
        return { ok: false, error: 'export_unavailable_on_youtube', hint: 'Needs direct pixel/byte access; not available for a YouTube source.' };
      }

      const timeCtx = { currentTime: state.player.currentTime, duration: state.player.duration, fps: state.player.fps };
      const start = parseTime(args.start, timeCtx);
      if (start === null) return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };
      const end = parseTime(args.end, timeCtx);
      if (end === null) return { ok: false, error: 'invalid_time', hint: '`end` must parse the same way as `start`.' };
      if (end <= start) return { ok: false, error: 'invalid_range', hint: '`end` must be after `start`.' };

      try {
        const input = await getInput(state.source);
        const result = await exportGif(input, { start, end, width: args.width, fps: args.fps, onProgress: (fraction) => ctx.progress(fraction) });

        const filename = `${EXPORT_BASENAME}.gif`;
        let downloadedAs: string | undefined;
        if (args.download !== false) {
          triggerBlobDownload(result.blob, filename);
          downloadedAs = filename;
        }

        return {
          ok: true,
          summary: `Exported GIF (${result.frames} frame(s), ${result.width}x${result.height})${downloadedAs ? `, saved to Downloads as ${downloadedAs}` : ''}`,
          frames: result.frames,
          width: result.width,
          height: result.height,
          bytes: result.blob.size,
          downloadedAs,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const [code] = message.split(':');
        return { ok: false, error: code || 'export_failed', hint: message };
      }
    },
  });
}
