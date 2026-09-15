import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../../src/store/db';
import { deletePersistedFrame, getPersistedThumbnails, persistFrame, persistThumbnails } from '../../src/store/frames';

describe('store/frames persistence', () => {
  afterEach(async () => {
    await db.frames.clear();
    await db.thumbnails.clear();
  });

  it('persistFrame writes a frame row stamped with the default project and a createdAt', async () => {
    const blob = new Blob([new Uint8Array(4)], { type: 'image/png' });
    await persistFrame({ id: 'f1', time: 2, kind: 'frame', width: 640, height: 360, blob });

    const stored = await db.frames.get('f1');
    expect(stored).toMatchObject({ id: 'f1', projectId: 'default', time: 2, kind: 'frame', width: 640, height: 360 });
    expect(stored?.createdAt).toBeGreaterThan(0);
  });

  it('deletePersistedFrame removes the row', async () => {
    await persistFrame({ id: 'f1', time: 0, kind: 'frame', width: 1, height: 1, blob: new Blob() });
    await deletePersistedFrame('f1');
    expect(await db.frames.get('f1')).toBeUndefined();
  });

  it('persistThumbnails/getPersistedThumbnails round-trip, replacing a previous sprite for the same asset', async () => {
    const spriteBlob = new Blob([new Uint8Array(8)], { type: 'image/webp' });
    await persistThumbnails('asset-1', spriteBlob, 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nsprite.webp#xywh=0,0,160,90\n');

    const first = await getPersistedThumbnails('asset-1');
    expect(first?.vtt).toContain('WEBVTT');

    const secondSprite = new Blob([new Uint8Array(16)], { type: 'image/webp' });
    await persistThumbnails('asset-1', secondSprite, 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nsprite.webp#xywh=0,0,160,90\n');

    const rows = await db.thumbnails.where('assetId').equals('asset-1').toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.vtt).toContain('00:00:02.000');
  });

  it('getPersistedThumbnails returns undefined for an asset with no sprite yet', async () => {
    expect(await getPersistedThumbnails('nope')).toBeUndefined();
  });
});
