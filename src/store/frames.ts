import { DEFAULT_PROJECT_ID } from '../lib/types';
import { db, type FrameRow, type ThumbnailRow } from './db';

/** Persists a captured frame's bytes to Dexie (Task 5). The in-memory Frames tray (studio.ts's
 * `frames` slice) is the source of truth for the current session's display; this table is a
 * durability backstop for the bytes themselves, not yet wired to restore the tray across a
 * reload (out of Task 5's own DoD -- capture correctness, thumbnails, and downloads -- revisit
 * if a later task needs frames to survive a reload the way the library's videos do). */
export async function persistFrame(row: Omit<FrameRow, 'projectId' | 'createdAt'>): Promise<void> {
  await db.frames.put({ ...row, projectId: DEFAULT_PROJECT_ID, createdAt: Date.now() });
}

export async function deletePersistedFrame(id: string): Promise<void> {
  await db.frames.delete(id);
}

/** One sprite+VTT pair per asset -- a later generate_thumbnails call for the same asset replaces
 * the previous one rather than accumulating (`put` with the assetId as the row id). */
export async function persistThumbnails(assetId: string, spriteBlob: Blob, vtt: string): Promise<void> {
  const row: ThumbnailRow = { id: assetId, assetId, spriteBlob, vtt };
  await db.thumbnails.put(row);
}

export async function getPersistedThumbnails(assetId: string): Promise<ThumbnailRow | undefined> {
  return db.thumbnails.get(assetId);
}
