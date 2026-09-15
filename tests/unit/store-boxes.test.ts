import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../../src/store/db';
import { deletePersistedBox, deletePersistedTrack, getPersistedBoxMask, persistBox, persistTrack } from '../../src/store/boxes';

describe('store/boxes persistence', () => {
  afterEach(async () => {
    await db.boxes.clear();
    await db.tracks.clear();
  });

  it('persistBox writes a box row, with its mask blob when segment produced one', async () => {
    const maskBlob = new Blob([new Uint8Array(4)], { type: 'image/png' });
    await persistBox({ id: 'b1', time: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2, label: 'tent', source: 'segment', maskId: 'b1', maskBlob });

    const stored = await db.boxes.get('b1');
    expect(stored).toMatchObject({ id: 'b1', label: 'tent', source: 'segment' });
    expect(stored?.maskBlob).toEqual(maskBlob);
  });

  it('persistBox omits maskBlob for a manually-drawn box', async () => {
    await persistBox({ id: 'b2', time: 0, x: 0, y: 0, w: 1, h: 1, label: 'manual box', source: 'manual' });
    const stored = await db.boxes.get('b2');
    expect(stored?.maskBlob).toBeUndefined();
  });

  it('deletePersistedBox removes the row', async () => {
    await persistBox({ id: 'b1', time: 0, x: 0, y: 0, w: 1, h: 1, label: 'x', source: 'agent' });
    await deletePersistedBox('b1');
    expect(await db.boxes.get('b1')).toBeUndefined();
  });

  it('getPersistedBoxMask returns the stored mask blob, or undefined when there is none', async () => {
    const maskBlob = new Blob([new Uint8Array(4)], { type: 'image/png' });
    await persistBox({ id: 'b1', time: 0, x: 0, y: 0, w: 1, h: 1, label: 'x', source: 'segment', maskBlob });
    expect(await getPersistedBoxMask('b1')).toEqual(maskBlob);
    expect(await getPersistedBoxMask('missing')).toBeUndefined();
  });

  it('persistTrack/deletePersistedTrack round-trip a track row', async () => {
    await persistTrack({ id: 't1', boxIds: ['b1'], keyframes: [{ time: 0, box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } }] });
    expect(await db.tracks.get('t1')).toMatchObject({ id: 't1', boxIds: ['b1'] });

    await deletePersistedTrack('t1');
    expect(await db.tracks.get('t1')).toBeUndefined();
  });
});
