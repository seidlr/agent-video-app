import { db } from './db';
import type { Box, Chapter, Clip, Note, Track } from '../lib/types';
import type { StudioStore } from './studio';

interface SimpleTable<T> {
  bulkDelete(keys: string[]): Promise<void>;
  put(row: T): Promise<string>;
}

async function syncSimpleTable<T extends { id: string }>(table: SimpleTable<T>, prevRows: T[], nextRows: T[]): Promise<void> {
  const nextIds = new Set(nextRows.map((r) => r.id));
  const removed = prevRows.filter((r) => !nextIds.has(r.id)).map((r) => r.id);
  if (removed.length > 0) await table.bulkDelete(removed);
  const prevById = new Map(prevRows.map((r) => [r.id, r]));
  for (const row of nextRows) {
    if (prevById.get(row.id) === row) continue; // same reference -- unchanged since the last sync
    await table.put(row);
  }
}

export const syncNotes = (prev: Note[], next: Note[]): Promise<void> => syncSimpleTable(db.notes, prev, next);
export const syncChapters = (prev: Chapter[], next: Chapter[]): Promise<void> => syncSimpleTable(db.chapters, prev, next);
export const syncTracks = (prev: Track[], next: Track[]): Promise<void> => syncSimpleTable(db.tracks, prev, next);
export const syncClips = (prev: Clip[], next: Clip[]): Promise<void> => syncSimpleTable(db.clips, prev, next);

/**
 * Boxes get their own sync instead of `syncSimpleTable`: the Dexie `boxes` table carries an extra
 * `maskBlob` field (Task 7's `segment` mask PNGs, written separately by `store/boxes.ts`'s own
 * `persistBox`) that the in-memory `Box` never has. A plain `put()` on every change would
 * overwrite an existing mask with nothing the moment any OTHER field (label, position) changes,
 * since IndexedDB `put` replaces the whole object at that key. `update()` instead merges only the
 * keys present on the in-memory `Box`, leaving a previously-written `maskBlob` untouched; only a
 * genuinely new box (no existing row) goes through `put()`, since there's nothing to preserve yet.
 */
export async function syncBoxes(prevRows: Box[], nextRows: Box[]): Promise<void> {
  const nextIds = new Set(nextRows.map((b) => b.id));
  const removed = prevRows.filter((b) => !nextIds.has(b.id)).map((b) => b.id);
  if (removed.length > 0) await db.boxes.bulkDelete(removed);
  const prevById = new Map(prevRows.map((b) => [b.id, b]));
  for (const box of nextRows) {
    const prevRow = prevById.get(box.id);
    if (prevRow === box) continue;
    if (prevRow) {
      await db.boxes.update(box.id, box);
    } else {
      await db.boxes.put(box);
    }
  }
}

/**
 * Subscribes once to the whole store and keeps notes/chapters/boxes/tracks/clips in sync with
 * Dexie -- closing a durability gap left open since Tasks 5-8 (each of `persistFrame`/`persistBox`
 * carried a "not yet wired to restore ... across a reload" comment) that contradicts the plan's
 * own top-level Verification bullet #2: "the last project, its video, frames, boxes, notes and
 * transcript are all still present and playable" after a reload. Each slice is always REPLACED
 * (never mutated in place) by its own store action, so reference inequality against the previous
 * state cheaply detects "did this slice change" without a deep diff. Fire-and-forget: a Dexie
 * write never blocks a UI interaction or tool call, matching this app's existing
 * durability-backstop philosophy (persistFrame/persistBox/persistTranscript are the same shape).
 */
export function wireProjectPersistence(store: StudioStore): () => void {
  return store.subscribe((state, prev) => {
    if (state.notes !== prev.notes) void syncNotes(prev.notes, state.notes);
    if (state.chapters !== prev.chapters) void syncChapters(prev.chapters, state.chapters);
    if (state.boxes !== prev.boxes) void syncBoxes(prev.boxes, state.boxes);
    if (state.tracks !== prev.tracks) void syncTracks(prev.tracks, state.tracks);
    if (state.clips !== prev.clips) void syncClips(prev.clips, state.clips);
  });
}

/**
 * Reads every persisted row back into the store on boot -- the restore half of the same gap.
 * Best-effort, same tolerance as main.tsx's existing `getLastSource`-driven source restore: run
 * once at startup, before `wireProjectPersistence` (so the restore's own `setX` calls don't incur
 * a redundant, if harmless, round-trip write back to the rows they were just read from).
 */
export async function restoreProjectData(store: StudioStore): Promise<void> {
  const [notes, chapters, boxes, tracks, clips] = await Promise.all([
    db.notes.toArray(),
    db.chapters.toArray(),
    db.boxes.toArray(),
    db.tracks.toArray(),
    db.clips.toArray(),
  ]);
  const state = store.getState();
  state.setNotes(notes);
  state.setChapters(chapters);
  state.setBoxes(boxes);
  state.setTracks(tracks);
  state.setClips(clips);
}
