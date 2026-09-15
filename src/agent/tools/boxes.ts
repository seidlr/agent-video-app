import { isBoxVisibleAt } from '../../lib/boxVisibility';
import { parseTime, secsToTimecode } from '../../lib/time';
import type { BoxSource } from '../../lib/types';
import type { StudioStore } from '../../store/studio';
import type { Registry, ToolResult } from '../registry';

/** boxes CRUD tools: list_boxes, add_box, update_box, delete_box, clear_boxes. ML-driven box
 * creation (segment/detect/track) is Task 7's job; this only wires the plain object-model CRUD
 * the store already has, per the plan's own note that Task 6 owns "boxes CRUD only". All `always`
 * -- boxes are timeline metadata, not pixel data, so no decode access is needed to manage them. */
export function defineBoxesTools(registry: Registry, store: StudioStore): void {
  function resolveTime(input: string | number): number | null {
    const { player } = store.getState();
    return parseTime(input, { currentTime: player.currentTime, duration: player.duration, fps: player.fps });
  }

  registry.define<{ time?: string | number }>({
    name: 'list_boxes',
    description: 'Lists boxes, optionally filtered to only those visible at a given time.',
    inputSchema: { type: 'object', properties: { time: { type: ['string', 'number'] } } },
    annotations: { readOnlyHint: true },
    group: 'boxes',
    when: 'always',
    handler: (args): ToolResult => {
      const boxes = store.getState().boxes;
      if (args.time === undefined) return { ok: true, summary: `${boxes.length} box(es)`, boxes };

      const at = resolveTime(args.time);
      if (at === null) return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };
      const visible = boxes.filter((b) => isBoxVisibleAt(b, at));
      return { ok: true, summary: `${visible.length} box(es) visible at ${secsToTimecode(at)}`, boxes: visible };
    },
  });

  registry.define<{ time: string | number; until?: string | number; x: number; y: number; w: number; h: number; label: string }>({
    name: 'add_box',
    description: 'Draws a box overlay at a point in time (or a range, with `until`). Coordinates are normalized [0,1] fractions of the frame.',
    inputSchema: {
      type: 'object',
      properties: {
        time: { type: ['string', 'number'] },
        until: { type: ['string', 'number'] },
        x: { type: 'number', minimum: 0, maximum: 1 },
        y: { type: 'number', minimum: 0, maximum: 1 },
        w: { type: 'number', minimum: 0, maximum: 1 },
        h: { type: 'number', minimum: 0, maximum: 1 },
        label: { type: 'string' },
      },
      required: ['time', 'x', 'y', 'w', 'h', 'label'],
    },
    group: 'boxes',
    when: 'always',
    handler: (args): ToolResult => {
      const time = resolveTime(args.time);
      if (time === null) return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };

      let until: number | undefined;
      if (args.until !== undefined) {
        const resolvedUntil = resolveTime(args.until);
        if (resolvedUntil === null) return { ok: false, error: 'invalid_time', hint: '`until` must parse the same way as `time`.' };
        if (resolvedUntil <= time) return { ok: false, error: 'invalid_range', hint: '`until` must be after `time`.' };
        until = resolvedUntil;
      }

      const source: BoxSource = 'agent';
      const boxId = store.getState().addBox({ time, until, x: args.x, y: args.y, w: args.w, h: args.h, label: args.label, source });
      return { ok: true, summary: `Added box "${args.label}" at ${secsToTimecode(time)}`, boxId };
    },
  });

  registry.define<{ boxId: string; time?: string | number; until?: string | number; x?: number; y?: number; w?: number; h?: number; label?: string }>({
    name: 'update_box',
    description: "Edits an existing box's time, until, coordinates, or label.",
    inputSchema: {
      type: 'object',
      properties: {
        boxId: { type: 'string' },
        time: { type: ['string', 'number'] },
        until: { type: ['string', 'number'] },
        x: { type: 'number', minimum: 0, maximum: 1 },
        y: { type: 'number', minimum: 0, maximum: 1 },
        w: { type: 'number', minimum: 0, maximum: 1 },
        h: { type: 'number', minimum: 0, maximum: 1 },
        label: { type: 'string' },
      },
      required: ['boxId'],
    },
    group: 'boxes',
    when: 'always',
    handler: (args): ToolResult => {
      const exists = store.getState().boxes.some((b) => b.id === args.boxId);
      if (!exists) return { ok: false, error: 'unknown_box', hint: `no box with id "${args.boxId}"` };

      const patch: { time?: number; until?: number; x?: number; y?: number; w?: number; h?: number; label?: string } = {};
      if (args.time !== undefined) {
        const time = resolveTime(args.time);
        if (time === null) return { ok: false, error: 'invalid_time' };
        patch.time = time;
      }
      if (args.until !== undefined) {
        const until = resolveTime(args.until);
        if (until === null) return { ok: false, error: 'invalid_time' };
        patch.until = until;
      }
      if (args.x !== undefined) patch.x = args.x;
      if (args.y !== undefined) patch.y = args.y;
      if (args.w !== undefined) patch.w = args.w;
      if (args.h !== undefined) patch.h = args.h;
      if (args.label !== undefined) patch.label = args.label;

      store.getState().updateBox(args.boxId, patch);
      return { ok: true, summary: `Updated box ${args.boxId}` };
    },
  });

  registry.define<{ boxId: string }>({
    name: 'delete_box',
    description: 'Removes a box.',
    inputSchema: { type: 'object', properties: { boxId: { type: 'string' } }, required: ['boxId'] },
    group: 'boxes',
    when: 'always',
    handler: (args): ToolResult => {
      const exists = store.getState().boxes.some((b) => b.id === args.boxId);
      if (!exists) return { ok: false, error: 'unknown_box', hint: `no box with id "${args.boxId}"` };
      store.getState().removeBox(args.boxId);
      return { ok: true, summary: `Removed box ${args.boxId}` };
    },
  });

  registry.define({
    name: 'clear_boxes',
    description: 'Removes every box.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { consequentialHint: true },
    group: 'boxes',
    when: 'always',
    handler: (): ToolResult => {
      const count = store.getState().boxes.length;
      store.getState().clearBoxes();
      return { ok: true, summary: `Removed ${count} box(es)` };
    },
  });
}
