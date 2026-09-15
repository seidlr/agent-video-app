import { parseTime, secsToTimecode } from '../../lib/time';
import type { StudioStore } from '../../store/studio';
import type { Registry, ToolResult } from '../registry';

/**
 * Clips CRUD tools (Task 9): non-destructive ranges on the timeline that `export_video` later
 * trims/concatenates. `always` -- like notes/chapters/boxes, this is timeline metadata, not pixel
 * data, so no decode access is needed to manage the list itself.
 */
export function defineClipsTools(registry: Registry, store: StudioStore): void {
  function resolveTime(input: string | number): number | null {
    const { player } = store.getState();
    return parseTime(input, { currentTime: player.currentTime, duration: player.duration, fps: player.fps });
  }

  registry.define({
    name: 'list_clips',
    description: 'Lists the clips currently on the timeline, in export order.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    group: 'clips',
    when: 'always',
    handler: (): ToolResult => {
      const clips = store.getState().clips;
      return { ok: true, summary: `${clips.length} clip(s)`, clips };
    },
  });

  registry.define<{ start: string | number; end: string | number; name?: string }>({
    name: 'add_clip',
    description: 'Adds a non-destructive clip range for export_video/export_gif. Clips are ordered by when they were added; use reorder_clips to change that.',
    inputSchema: {
      type: 'object',
      properties: {
        start: { type: ['string', 'number'] },
        end: { type: ['string', 'number'] },
        name: { type: 'string' },
      },
      required: ['start', 'end'],
    },
    group: 'clips',
    when: 'always',
    handler: (args): ToolResult => {
      const start = resolveTime(args.start);
      if (start === null) return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };
      const end = resolveTime(args.end);
      if (end === null) return { ok: false, error: 'invalid_time', hint: '`end` must parse the same way as `start`.' };
      if (end <= start) return { ok: false, error: 'invalid_range', hint: '`end` must be after `start`.' };

      const order = store.getState().clips.length;
      const clipId = store.getState().addClip({ start, end, name: args.name, order });
      return { ok: true, summary: `Added clip ${secsToTimecode(start)} -> ${secsToTimecode(end)}`, clipId };
    },
  });

  registry.define<{ clipId: string }>({
    name: 'remove_clip',
    description: 'Removes a clip.',
    inputSchema: { type: 'object', properties: { clipId: { type: 'string' } }, required: ['clipId'] },
    group: 'clips',
    when: 'always',
    handler: (args): ToolResult => {
      const exists = store.getState().clips.some((c) => c.id === args.clipId);
      if (!exists) return { ok: false, error: 'unknown_clip', hint: `no clip with id "${args.clipId}"` };
      store.getState().removeClip(args.clipId);
      return { ok: true, summary: `Removed clip ${args.clipId}` };
    },
  });

  registry.define<{ order: string[] }>({
    name: 'reorder_clips',
    description: 'Reorders clips (and therefore their concatenation order in export_video) to match the given list of clip ids.',
    inputSchema: { type: 'object', properties: { order: { type: 'array', items: { type: 'string' } } }, required: ['order'] },
    group: 'clips',
    when: 'always',
    handler: (args): ToolResult => {
      const known = new Set(store.getState().clips.map((c) => c.id));
      const unknown = args.order.filter((id) => !known.has(id));
      if (unknown.length > 0) return { ok: false, error: 'unknown_clip', hint: `unknown clip id(s): ${unknown.join(', ')}` };
      store.getState().reorderClips(args.order);
      return { ok: true, summary: `Reordered ${args.order.length} clip(s)` };
    },
  });
}
