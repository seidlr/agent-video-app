import { db, type BoxRow } from './db';
import type { Track } from '../lib/types';

/** Persists a box (and its mask PNG, if `segment` produced one) to Dexie -- a durability backstop
 * for the bytes/metadata, same scope boundary as store/frames.ts's persistFrame: not yet wired to
 * restore boxes/tracks across a reload. */
export async function persistBox(row: BoxRow): Promise<void> {
  await db.boxes.put(row);
}

export async function deletePersistedBox(id: string): Promise<void> {
  await db.boxes.delete(id);
}

export async function getPersistedBoxMask(id: string): Promise<Blob | undefined> {
  return (await db.boxes.get(id))?.maskBlob;
}

export async function persistTrack(track: Track): Promise<void> {
  await db.tracks.put(track);
}

export async function deletePersistedTrack(id: string): Promise<void> {
  await db.tracks.delete(id);
}
