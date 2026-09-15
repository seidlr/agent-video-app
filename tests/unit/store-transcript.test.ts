import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../../src/store/db';
import { getPersistedTranscript, persistTranscript } from '../../src/store/transcript';

describe('store/transcript persistence', () => {
  afterEach(async () => {
    await db.transcripts.clear();
  });

  it('persistTranscript/getPersistedTranscript round-trip the original (lang:null) transcript', async () => {
    const segments = [{ start: 0, end: 2, text: 'hello' }];
    await persistTranscript('asset-1', null, segments);

    expect(await getPersistedTranscript('asset-1')).toEqual(segments);
  });

  it('keeps the original and a translated transcript as separate rows for the same asset', async () => {
    await persistTranscript('asset-1', null, [{ start: 0, end: 2, text: 'hello' }]);
    await persistTranscript('asset-1', 'de', [{ start: 0, end: 2, text: 'hallo' }]);

    expect(await getPersistedTranscript('asset-1', null)).toEqual([{ start: 0, end: 2, text: 'hello' }]);
    expect(await getPersistedTranscript('asset-1', 'de')).toEqual([{ start: 0, end: 2, text: 'hallo' }]);
  });

  it('a later persistTranscript for the same asset+lang replaces the previous segments', async () => {
    await persistTranscript('asset-1', null, [{ start: 0, end: 2, text: 'first' }]);
    await persistTranscript('asset-1', null, [{ start: 0, end: 2, text: 'first' }, { start: 2, end: 4, text: 'second' }]);

    expect(await getPersistedTranscript('asset-1')).toHaveLength(2);
  });

  it('returns null for an asset with no transcript yet', async () => {
    expect(await getPersistedTranscript('nope')).toBeNull();
  });
});
