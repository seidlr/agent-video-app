import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../../src/store/db';
import { clearPersistedEmbeddings, getPersistedEmbeddings, persistEmbeddings } from '../../src/store/embeddings';

describe('store/embeddings persistence', () => {
  afterEach(async () => {
    await db.embeddings.clear();
  });

  it('persistEmbeddings/getPersistedEmbeddings round-trip a Float32Array vector', async () => {
    await persistEmbeddings('asset-1', 'mobileclip', [{ time: 0.25, vector: new Float32Array([0.1, -0.2, 0.3]) }]);

    const rows = await getPersistedEmbeddings('asset-1', 'mobileclip');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.time).toBe(0.25);
    expect(Array.from(rows[0]!.vector)).toEqual([0.10000000149011612, -0.20000000298023224, 0.30000001192092896]);
  });

  it('keeps mobileclip and dino indexes separate for the same asset', async () => {
    await persistEmbeddings('asset-1', 'mobileclip', [{ time: 0, vector: new Float32Array([1]) }]);
    await persistEmbeddings('asset-1', 'dino', [{ time: 0, vector: new Float32Array([2]) }]);

    expect((await getPersistedEmbeddings('asset-1', 'mobileclip'))[0]!.vector[0]).toBe(1);
    expect((await getPersistedEmbeddings('asset-1', 'dino'))[0]!.vector[0]).toBe(2);
  });

  it('clearPersistedEmbeddings removes only the given kind', async () => {
    await persistEmbeddings('asset-1', 'mobileclip', [{ time: 0, vector: new Float32Array([1]) }]);
    await persistEmbeddings('asset-1', 'dino', [{ time: 0, vector: new Float32Array([2]) }]);

    await clearPersistedEmbeddings('asset-1', 'mobileclip');

    expect(await getPersistedEmbeddings('asset-1', 'mobileclip')).toHaveLength(0);
    expect(await getPersistedEmbeddings('asset-1', 'dino')).toHaveLength(1);
  });

  it('returns an empty array for an asset with no embeddings yet', async () => {
    expect(await getPersistedEmbeddings('nope', 'mobileclip')).toEqual([]);
  });
});
