import { describe, expect, it, vi } from 'vitest';

const saveLastSourceMock = vi.hoisted(() => vi.fn(async () => undefined));
const getLastSourceMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/store/library', () => ({
  readLibraryFile: vi.fn(async () => new File([new Uint8Array(4)], 'clip.mp4', { type: 'video/mp4' })),
  saveLastSource: saveLastSourceMock,
  getLastSource: getLastSourceMock,
}));

import { DEFAULT_PROJECT_ID } from '../../src/lib/types';
import { loadSource, restoreLastSourceOnBoot } from '../../src/media/load';
import type { StudioStore } from '../../src/store/studio';

/** Minimal fake matching just the `getState().source`/`setSource`/`storage`/`setStorageState`
 * surface restoreLastSourceOnBoot (via loadSource's own tryPersist call) actually touches. */
function fakeStore(initialSource: unknown = null) {
  let source = initialSource;
  let storage = { worksInThisContext: true };
  const setSource = vi.fn((s: unknown) => {
    source = s;
  });
  const setStorageState = vi.fn((patch: Partial<typeof storage>) => {
    storage = { ...storage, ...patch };
  });
  return { getState: () => ({ source, setSource, storage, setStorageState }) } as unknown as StudioStore;
}

describe('loadSource', () => {
  it('resolves the request, sets it as the active source, and persists it as the project last source', async () => {
    const setSource = vi.fn();
    const request = { kind: 'file' as const, id: 'a1' };

    await loadSource({ setSource, storage: { worksInThisContext: true } as never, setStorageState: vi.fn() }, request);

    expect(setSource).toHaveBeenCalledTimes(1);
    expect(setSource).toHaveBeenCalledWith(expect.objectContaining({ kind: 'file', assetId: 'a1' }));
    expect(saveLastSourceMock).toHaveBeenCalledWith(DEFAULT_PROJECT_ID, request);
  });

  it('does not persist the request when resolution fails', async () => {
    saveLastSourceMock.mockClear();
    const setSource = vi.fn();

    await expect(
      loadSource({ setSource, storage: { worksInThisContext: true } as never, setStorageState: vi.fn() }, { kind: 'file', id: undefined }),
    ).rejects.toThrow(/missing_id/);

    expect(setSource).not.toHaveBeenCalled();
    expect(saveLastSourceMock).not.toHaveBeenCalled();
  });

  it('skips persisting (without throwing) when storage is unavailable, and still sets the source', async () => {
    const setSource = vi.fn();
    const setStorageState = vi.fn();
    saveLastSourceMock.mockClear();

    await loadSource({ setSource, storage: { worksInThisContext: false } as never, setStorageState }, { kind: 'file', id: 'a1' });

    expect(setSource).toHaveBeenCalledTimes(1);
    expect(saveLastSourceMock).not.toHaveBeenCalled();
    expect(setStorageState).not.toHaveBeenCalled(); // already known-unavailable -- no redundant flip
  });
});

describe('restoreLastSourceOnBoot (Task 11 CI investigation: a real boot-time race)', () => {
  it('applies the persisted last source when nothing has loaded one in the meantime', async () => {
    // kind:'file' (not 'sample') so resolution goes through the already-mocked readLibraryFile
    // instead of a real network fetch for the sample catalog.
    getLastSourceMock.mockResolvedValueOnce({ kind: 'file', id: 'a1' });
    const store = fakeStore(null);

    await restoreLastSourceOnBoot(store, DEFAULT_PROJECT_ID);

    expect(store.getState().source).toMatchObject({ kind: 'file', assetId: 'a1' });
  });

  it('does nothing when there is no persisted last source', async () => {
    getLastSourceMock.mockResolvedValueOnce(undefined);
    const store = fakeStore(null);

    await restoreLastSourceOnBoot(store, DEFAULT_PROJECT_ID);

    expect(store.getState().source).toBeNull();
  });

  // The actual CI bug (tests/e2e/tools-playback.spec.ts's YouTube-narrowing test failing
  // deterministically, unaffected by any timeout bump): getLastSource()'s IndexedDB read is a
  // real async gap, and under real browser I/O contention it can resolve *after* a caller (an
  // agent's own load_video call, right at boot) has already loaded a different, newer source.
  // Blindly applying the restored value at that point silently reverts the newer load back --
  // exactly matching CI's observed symptom of every local/yt tool staying registered as if the
  // YouTube switch had never happened.
  it('does not clobber a source that was loaded while the restore read was still pending', async () => {
    let resolveRead!: (value: { kind: 'sample'; id: string }) => void;
    getLastSourceMock.mockReturnValueOnce(new Promise((resolve) => (resolveRead = resolve)));
    const store = fakeStore(null);

    const restorePromise = restoreLastSourceOnBoot(store, DEFAULT_PROJECT_ID);

    // Something else (an agent's own explicit load_video call) sets a fresher source before the
    // boot-time read resolves.
    store.getState().setSource({ kind: 'youtube', title: 'a real video' } as never);

    resolveRead({ kind: 'sample', id: 'sprite-fight' });
    await restorePromise;

    expect(store.getState().source).toMatchObject({ kind: 'youtube' });
  });
});
