import { parseTime, secsToTimecode } from '../../lib/time';
import type { StudioStore } from '../../store/studio';
import type { Registry, ToolResult } from '../registry';

/** notes tools: add_note, list_notes, update_note, delete_note. All `always` (no decode/pixel
 * access needed) -- per the plan's Task 6 tool manifest. */
export function defineNotesTools(registry: Registry, store: StudioStore): void {
  function resolveTime(input: string | number | undefined): number | null {
    if (input === undefined) return null;
    const { player } = store.getState();
    return parseTime(input, { currentTime: player.currentTime, duration: player.duration, fps: player.fps });
  }

  registry.define<{ time: string | number; end?: string | number; text: string; tags?: string[] }>({
    name: 'add_note',
    description: 'Adds a timestamped note, either a single point in time or a region (with `end`). Tags are freeform.',
    inputSchema: {
      type: 'object',
      properties: {
        time: { type: ['string', 'number'] },
        end: { type: ['string', 'number'] },
        text: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['time', 'text'],
    },
    group: 'notes',
    when: 'always',
    handler: (args): ToolResult => {
      const time = resolveTime(args.time);
      if (time === null) return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };

      let end: number | undefined;
      if (args.end !== undefined) {
        const resolvedEnd = resolveTime(args.end);
        if (resolvedEnd === null) return { ok: false, error: 'invalid_time', hint: '`end` must parse the same way as `time`.' };
        if (resolvedEnd <= time) return { ok: false, error: 'invalid_range', hint: '`end` must be after `time`.' };
        end = resolvedEnd;
      }

      const noteId = store.getState().addNote({ time, end, text: args.text, tags: args.tags ?? [], createdBy: 'agent' });
      return { ok: true, summary: `Added note at ${secsToTimecode(time)}${end !== undefined ? ` → ${secsToTimecode(end)}` : ''}: "${args.text}"`, noteId };
    },
  });

  registry.define({
    name: 'list_notes',
    description: 'Lists every note on the timeline, sorted by time.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    group: 'notes',
    when: 'always',
    handler: (): ToolResult => {
      const notes = store.getState().notes;
      return { ok: true, summary: `${notes.length} note(s)`, notes };
    },
  });

  registry.define<{ noteId: string; time?: string | number; end?: string | number; text?: string; tags?: string[] }>({
    name: 'update_note',
    description: 'Edits an existing note\'s time, end, text, or tags.',
    inputSchema: {
      type: 'object',
      properties: {
        noteId: { type: 'string' },
        time: { type: ['string', 'number'] },
        end: { type: ['string', 'number'] },
        text: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['noteId'],
    },
    group: 'notes',
    when: 'always',
    handler: (args): ToolResult => {
      const exists = store.getState().notes.some((n) => n.id === args.noteId);
      if (!exists) return { ok: false, error: 'unknown_note', hint: `no note with id "${args.noteId}"` };

      const patch: { time?: number; end?: number; text?: string; tags?: string[] } = {};
      if (args.time !== undefined) {
        const time = resolveTime(args.time);
        if (time === null) return { ok: false, error: 'invalid_time' };
        patch.time = time;
      }
      if (args.end !== undefined) {
        const end = resolveTime(args.end);
        if (end === null) return { ok: false, error: 'invalid_time' };
        patch.end = end;
      }
      if (args.text !== undefined) patch.text = args.text;
      if (args.tags !== undefined) patch.tags = args.tags;

      store.getState().updateNote(args.noteId, patch);
      return { ok: true, summary: `Updated note ${args.noteId}` };
    },
  });

  registry.define<{ noteId: string }>({
    name: 'delete_note',
    description: 'Removes a note from the timeline.',
    inputSchema: { type: 'object', properties: { noteId: { type: 'string' } }, required: ['noteId'] },
    group: 'notes',
    when: 'always',
    handler: (args): ToolResult => {
      const exists = store.getState().notes.some((n) => n.id === args.noteId);
      if (!exists) return { ok: false, error: 'unknown_note', hint: `no note with id "${args.noteId}"` };
      store.getState().removeNote(args.noteId);
      return { ok: true, summary: `Removed note ${args.noteId}` };
    },
  });
}
