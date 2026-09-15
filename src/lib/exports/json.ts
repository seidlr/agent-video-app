import type { ExportContext } from './types';

export interface JsonDoc {
  version: 1;
  asset: ExportContext['asset'];
  chapters: ExportContext['chapters'];
  notes: ExportContext['notes'];
  boxes: ExportContext['boxes'];
  tracks: NonNullable<ExportContext['tracks']>;
  clips: NonNullable<ExportContext['clips']>;
}

/** Versioned `{version:1, asset, chapters, notes, boxes, tracks, clips}` per the plan's Task 6 Key
 * Decisions -- `version` lets a future format change (Task 9's real project export/import) tell
 * an old export apart from a new one. `tracks`/`clips` default to `[]` when the context omits
 * them (they're Task 7/Task 9 features), so a Task 6-era export is still a complete, valid
 * document rather than missing keys. Exported separately (not just as a JSON string) so Task 9's
 * `media/project.ts` can reuse the exact same shape for `project.json` inside the zip instead of
 * re-deriving it and risking the two schemas drifting apart. */
export function buildJsonDoc(ctx: ExportContext): JsonDoc {
  return {
    version: 1,
    asset: ctx.asset,
    chapters: ctx.chapters,
    notes: ctx.notes,
    boxes: ctx.boxes,
    tracks: ctx.tracks ?? [],
    clips: ctx.clips ?? [],
  };
}

export function exportJson(ctx: ExportContext): string {
  return `${JSON.stringify(buildJsonDoc(ctx), null, 2)}\n`;
}
