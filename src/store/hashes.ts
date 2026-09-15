import { db, type HashRow } from './db';
import type { FrameSample } from '../media/scenes';

/** Persists every sampled frame's descriptor for `assetId` -- a durability backstop so a reload
 * doesn't force re-decoding the whole video to rebuild the scene/similarity index (same scope
 * boundary as store/frames.ts's persistFrame: bytes/metadata survive, in-memory caches don't
 * automatically restore from them yet). `dhash` (a bigint) is stored as its decimal string since
 * IndexedDB/Dexie don't index bigint values. */
export async function persistHashes(assetId: string, samples: FrameSample[]): Promise<void> {
  const rows: HashRow[] = samples.map((s) => ({ id: `${assetId}:${s.time}`, assetId, time: s.time, dhash: s.dhash.toString(), hist: Array.from(s.hist) }));
  await db.hashes.bulkPut(rows);
}

export async function getPersistedHashes(assetId: string): Promise<FrameSample[]> {
  const rows = await db.hashes.where('assetId').equals(assetId).toArray();
  return rows.map((r) => ({ time: r.time, dhash: BigInt(r.dhash), hist: Uint8Array.from(r.hist) }));
}

export async function clearPersistedHashes(assetId: string): Promise<void> {
  await db.hashes.where('assetId').equals(assetId).delete();
}
