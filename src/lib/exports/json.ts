import type { ExportContext } from './types';

/** Versioned `{version:1, asset, chapters, notes, boxes, tracks, clips}` per the plan's Task 6 Key
 * Decisions -- `version` lets a future format change (Task 9's real project export/import) tell
 * an old export apart from a new one. `tracks`/`clips` default to `[]` when the context omits
 * them (they're Task 7/Task 9 features), so a Task 6-era export is still a complete, valid
 * document rather than missing keys. */
export function exportJson(ctx: ExportContext): string {
  const doc = {
    version: 1,
    asset: ctx.asset,
    chapters: ctx.chapters,
    notes: ctx.notes,
    boxes: ctx.boxes,
    tracks: ctx.tracks ?? [],
    clips: ctx.clips ?? [],
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}
