import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { StudioDB } from '../../src/store/db';

describe('StudioDB', () => {
  let db: StudioDB;

  afterEach(async () => {
    await db?.delete();
  });

  it('opens with all documented tables', async () => {
    db = new StudioDB('test-db-open');
    await db.open();
    expect(db.tables.map((t) => t.name).sort()).toEqual(
      ['assets', 'boxes', 'chapters', 'clips', 'frames', 'hashes', 'notes', 'projects', 'thumbnails', 'tracks', 'transcripts'].sort(),
    );
  });

  it('round-trips a note through the notes table', async () => {
    db = new StudioDB('test-db-note');
    const note = {
      id: 'n1',
      time: 1.5,
      text: 'hello',
      tags: ['x'],
      createdBy: 'agent' as const,
      createdAt: Date.now(),
    };
    await db.notes.put(note);
    const stored = await db.notes.get('n1');
    expect(stored).toEqual(note);
  });
});
