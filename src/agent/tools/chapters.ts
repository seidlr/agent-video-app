import { parseChaptersVtt } from '../../lib/chapters';
import { parseTime, secsToTimecode } from '../../lib/time';
import type { StudioStore } from '../../store/studio';
import type { Registry, ToolResult } from '../registry';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** chapters tools: add_chapter, list_chapters, update_chapter, delete_chapter, import_vtt. All
 * `always` -- per the plan's Task 6 tool manifest. Chapters are an object model (store.chapters);
 * lib/chapters.ts derives the VTT `<Track kind="chapters">` src vidstack actually needs. */
export function defineChaptersTools(registry: Registry, store: StudioStore): void {
  function resolveTime(input: string | number): number | null {
    const { player } = store.getState();
    return parseTime(input, { currentTime: player.currentTime, duration: player.duration, fps: player.fps });
  }

  registry.define<{ start: string | number; end: string | number; title: string }>({
    name: 'add_chapter',
    description: 'Adds a chapter (a titled time range). Rejects a range that overlaps an existing chapter.',
    inputSchema: {
      type: 'object',
      properties: { start: { type: ['string', 'number'] }, end: { type: ['string', 'number'] }, title: { type: 'string' } },
      required: ['start', 'end', 'title'],
    },
    group: 'chapters',
    when: 'always',
    handler: (args): ToolResult => {
      const start = resolveTime(args.start);
      const end = resolveTime(args.end);
      if (start === null || end === null) return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };
      if (end <= start) return { ok: false, error: 'invalid_range', hint: '`end` must be after `start`.' };

      try {
        const chapterId = store.getState().addChapter({ start, end, title: args.title });
        return { ok: true, summary: `Added chapter "${args.title}" (${secsToTimecode(start)} → ${secsToTimecode(end)})`, chapterId };
      } catch (error) {
        if (errorMessage(error).startsWith('chapter_overlap')) {
          return { ok: false, error: 'chapter_overlap', hint: 'Overlaps an existing chapter; adjust start/end or update the existing one instead.' };
        }
        throw error;
      }
    },
  });

  registry.define({
    name: 'list_chapters',
    description: 'Lists every chapter, sorted by start time.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    group: 'chapters',
    when: 'always',
    handler: (): ToolResult => {
      const chapters = store.getState().chapters;
      return { ok: true, summary: `${chapters.length} chapter(s)`, chapters };
    },
  });

  registry.define<{ chapterId: string; start?: string | number; end?: string | number; title?: string }>({
    name: 'update_chapter',
    description: "Edits an existing chapter's start, end, or title.",
    inputSchema: {
      type: 'object',
      properties: {
        chapterId: { type: 'string' },
        start: { type: ['string', 'number'] },
        end: { type: ['string', 'number'] },
        title: { type: 'string' },
      },
      required: ['chapterId'],
    },
    group: 'chapters',
    when: 'always',
    handler: (args): ToolResult => {
      const existing = store.getState().chapters.find((c) => c.id === args.chapterId);
      if (!existing) return { ok: false, error: 'unknown_chapter', hint: `no chapter with id "${args.chapterId}"` };

      const patch: { start?: number; end?: number; title?: string } = {};
      if (args.start !== undefined) {
        const start = resolveTime(args.start);
        if (start === null) return { ok: false, error: 'invalid_time' };
        patch.start = start;
      }
      if (args.end !== undefined) {
        const end = resolveTime(args.end);
        if (end === null) return { ok: false, error: 'invalid_time' };
        patch.end = end;
      }
      if (args.title !== undefined) patch.title = args.title;

      const nextStart = patch.start ?? existing.start;
      const nextEnd = patch.end ?? existing.end;
      if (nextEnd <= nextStart) return { ok: false, error: 'invalid_range', hint: '`end` must be after `start`.' };
      const overlapsAnother = store
        .getState()
        .chapters.some((c) => c.id !== args.chapterId && nextStart < c.end && nextEnd > c.start);
      if (overlapsAnother) return { ok: false, error: 'chapter_overlap', hint: 'Overlaps another chapter; adjust start/end instead.' };

      store.getState().updateChapter(args.chapterId, patch);
      return { ok: true, summary: `Updated chapter ${args.chapterId}` };
    },
  });

  registry.define<{ chapterId: string }>({
    name: 'delete_chapter',
    description: 'Removes a chapter.',
    inputSchema: { type: 'object', properties: { chapterId: { type: 'string' } }, required: ['chapterId'] },
    group: 'chapters',
    when: 'always',
    handler: (args): ToolResult => {
      const exists = store.getState().chapters.some((c) => c.id === args.chapterId);
      if (!exists) return { ok: false, error: 'unknown_chapter', hint: `no chapter with id "${args.chapterId}"` };
      store.getState().removeChapter(args.chapterId);
      return { ok: true, summary: `Removed chapter ${args.chapterId}` };
    },
  });

  registry.define<{ vtt: string }>({
    name: 'import_vtt',
    description: 'Imports chapters from a WEBVTT string, adding every cue that does not overlap an existing chapter.',
    inputSchema: { type: 'object', properties: { vtt: { type: 'string' } }, required: ['vtt'] },
    group: 'chapters',
    when: 'always',
    handler: (args): ToolResult => {
      const parsed = parseChaptersVtt(args.vtt);
      if (parsed.length === 0) return { ok: false, error: 'no_cues', hint: 'The VTT text had no parseable cues.' };

      const importedIds: string[] = [];
      let skipped = 0;
      for (const cue of parsed) {
        try {
          importedIds.push(store.getState().addChapter(cue));
        } catch {
          skipped++;
        }
      }

      return {
        ok: true,
        summary: `Imported ${importedIds.length} chapter(s)${skipped > 0 ? `, skipped ${skipped} overlapping cue(s)` : ''}`,
        chapterIds: importedIds,
        skipped,
      };
    },
  });
}
