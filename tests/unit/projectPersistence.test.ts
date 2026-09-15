import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../../src/store/db';
import { restoreProjectData, syncBoxes, syncChapters, syncClips, syncNotes, syncTracks } from '../../src/store/projectPersistence';
import { createStudioStore } from '../../src/store/studio';

describe('store/projectPersistence', () => {
  afterEach(async () => {
    await Promise.all([db.notes.clear(), db.chapters.clear(), db.boxes.clear(), db.tracks.clear(), db.clips.clear()]);
  });

  it('syncNotes adds/removes rows to match the new array', async () => {
    const note = { id: 'n1', time: 1, text: 'hi', tags: [], createdBy: 'user' as const, createdAt: 0 };
    await syncNotes([], [note]);
    expect(await db.notes.get('n1')).toEqual(note);

    await syncNotes([note], []);
    expect(await db.notes.get('n1')).toBeUndefined();
  });

  it('syncChapters/syncTracks/syncClips add and remove rows the same way', async () => {
    const chapter = { id: 'c1', start: 0, end: 2, title: 'Intro' };
    await syncChapters([], [chapter]);
    expect(await db.chapters.get('c1')).toEqual(chapter);
    await syncChapters([chapter], []);
    expect(await db.chapters.get('c1')).toBeUndefined();

    const track = { id: 't1', boxIds: ['b1'], keyframes: [] };
    await syncTracks([], [track]);
    expect(await db.tracks.get('t1')).toEqual(track);

    const clip = { id: 'cl1', start: 0, end: 1, order: 0 };
    await syncClips([], [clip]);
    expect(await db.clips.get('cl1')).toEqual(clip);
  });

  it('syncBoxes preserves an existing maskBlob when only a plain field changes (update, not put)', async () => {
    const maskBlob = new Blob([new Uint8Array(4)], { type: 'image/png' });
    const box1 = { id: 'b1', time: 0, x: 0, y: 0, w: 1, h: 1, label: 'tent', source: 'segment' as const };
    await syncBoxes([], [box1]);
    // Simulate segment.ts's own persistBox call separately writing the mask blob onto the same row.
    await db.boxes.update('b1', { maskBlob });
    expect((await db.boxes.get('b1'))?.maskBlob).toEqual(maskBlob);

    const box1Relabeled = { ...box1, label: 'red tent' };
    await syncBoxes([box1], [box1Relabeled]);

    const stored = await db.boxes.get('b1');
    expect(stored?.label).toBe('red tent');
    expect(stored?.maskBlob).toEqual(maskBlob);
  });

  it('syncBoxes deletes rows removed from the array and adds brand-new ones via put', async () => {
    const boxA = { id: 'bA', time: 0, x: 0, y: 0, w: 1, h: 1, label: 'a', source: 'manual' as const };
    const boxB = { id: 'bB', time: 1, x: 0, y: 0, w: 1, h: 1, label: 'b', source: 'manual' as const };
    await syncBoxes([], [boxA]);
    await syncBoxes([boxA], [boxA, boxB]);
    expect(await db.boxes.get('bB')).toMatchObject({ label: 'b' });

    await syncBoxes([boxA, boxB], [boxB]);
    expect(await db.boxes.get('bA')).toBeUndefined();
    expect(await db.boxes.get('bB')).toMatchObject({ label: 'b' });
  });

  it('restoreProjectData populates the store from whatever is persisted', async () => {
    const note = { id: 'n1', time: 1, text: 'hi', tags: [], createdBy: 'user' as const, createdAt: 0 };
    const chapter = { id: 'c1', start: 0, end: 2, title: 'Intro' };
    const box = { id: 'b1', time: 0, x: 0, y: 0, w: 1, h: 1, label: 'x', source: 'manual' as const };
    await db.notes.put(note);
    await db.chapters.put(chapter);
    await db.boxes.put(box);

    const store = createStudioStore();
    await restoreProjectData(store);

    expect(store.getState().notes).toEqual([note]);
    expect(store.getState().chapters).toEqual([chapter]);
    expect(store.getState().boxes).toEqual([box]);
    expect(store.getState().tracks).toEqual([]);
    expect(store.getState().clips).toEqual([]);
  });
});
