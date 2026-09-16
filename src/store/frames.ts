import { DEFAULT_PROJECT_ID } from '../lib/types';
import { db, type FrameRow, type ThumbnailRow } from './db';
import type { StudioStore } from './studio';

/** Persists a captured frame's bytes to Dexie (Task 5). The in-memory Frames tray (studio.ts's
 * `frames` slice) is the source of truth for the current session's display; this table is a
 * durability backstop for the bytes themselves -- `restoreFrames` below is the boot-time restore
 * half (Task 9's own reload-persistence pass; see store/projectPersistence.ts for why). */
export async function persistFrame(row: Omit<FrameRow, 'projectId' | 'createdAt'>): Promise<void> {
  await db.frames.put({ ...row, projectId: DEFAULT_PROJECT_ID, createdAt: Date.now() });
}

export async function deletePersistedFrame(id: string): Promise<void> {
  await db.frames.delete(id);
}

/** Reads every persisted frame back into the Frames tray on boot, ordered by time -- object URLs
 * never survive a reload (FrameEntry's own doc comment), so each restored row gets a fresh
 * `URL.createObjectURL` over its still-intact Dexie blob rather than trying to reuse anything from
 * the previous session. Best-effort, same tolerance as the rest of this app's boot restore path. */
export async function restoreFrames(store: StudioStore): Promise<void> {
  const rows = await db.frames.where('projectId').equals(DEFAULT_PROJECT_ID).sortBy('time');
  store.getState().setFrames(
    rows.map((row) => ({
      id: row.id,
      time: row.time,
      kind: row.kind,
      width: row.width,
      height: row.height,
      downloadedAs: row.downloadedAs,
      sourceFrameId: row.sourceFrameId,
      blobUrl: URL.createObjectURL(row.blob),
    })),
  );
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
