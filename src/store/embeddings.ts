import { db, type EmbeddingRow } from './db';

export interface StoredEmbedding {
  time: number;
  vector: Float32Array;
}

export async function persistEmbeddings(assetId: string, kind: EmbeddingRow['kind'], samples: StoredEmbedding[]): Promise<void> {
  const rows: EmbeddingRow[] = samples.map((s) => ({ id: `${assetId}:${kind}:${s.time}`, assetId, kind, time: s.time, vector: Array.from(s.vector) }));
  await db.embeddings.bulkPut(rows);
}

export async function getPersistedEmbeddings(assetId: string, kind: EmbeddingRow['kind']): Promise<StoredEmbedding[]> {
  const rows = await db.embeddings.where({ assetId, kind }).toArray();
  return rows.map((r) => ({ time: r.time, vector: Float32Array.from(r.vector) }));
}

export async function clearPersistedEmbeddings(assetId: string, kind: EmbeddingRow['kind']): Promise<void> {
  await db.embeddings.where({ assetId, kind }).delete();
}
