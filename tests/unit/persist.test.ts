import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensurePersisted, readStorageEstimate, tryPersist } from '../../src/store/persist';
import { createStudioStore } from '../../src/store/studio';

describe('ensurePersisted', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports true without requesting when already persisted', async () => {
    const persist = vi.fn();
    vi.stubGlobal('navigator', { storage: { persisted: async () => true, persist } });
    expect(await ensurePersisted()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('requests persistence and returns its result when not yet persisted', async () => {
    vi.stubGlobal('navigator', {
      storage: { persisted: async () => false, persist: async () => true },
    });
    expect(await ensurePersisted()).toBe(true);
  });

  it('returns false when the browser denies persistence', async () => {
    vi.stubGlobal('navigator', {
      storage: { persisted: async () => false, persist: async () => false },
    });
    expect(await ensurePersisted()).toBe(false);
  });

  it('returns false without throwing when storage.persist is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    expect(await ensurePersisted()).toBe(false);
  });
});

describe('readStorageEstimate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns usage/quota from navigator.storage.estimate()', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: async () => ({ usage: 123, quota: 456 }) },
    });
    expect(await readStorageEstimate()).toEqual({ usage: 123, quota: 456 });
  });

  it('returns zeros without throwing on Safari < 17 (no estimate())', async () => {
    vi.stubGlobal('navigator', { storage: {} });
    expect(await readStorageEstimate()).toEqual({ usage: 0, quota: 0 });
  });
});

describe('tryPersist (Task 11 DoD: skip OPFS/Dexie when the probe fails)', () => {
  it('runs the write and leaves storage marked as working when it succeeds', async () => {
    const store = createStudioStore();
    const fn = vi.fn().mockResolvedValue(undefined);
    await tryPersist(store.getState(), fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(store.getState().storage.worksInThisContext).toBe(true);
  });

  it('never lets a thrown write propagate, and flips storage to unavailable', async () => {
    const store = createStudioStore();
    const fn = vi.fn().mockRejectedValue(new Error('SecurityError'));
    await expect(tryPersist(store.getState(), fn)).resolves.toBeUndefined();
    expect(store.getState().storage.worksInThisContext).toBe(false);
  });

  it('skips the write entirely once storage is already known-unavailable', async () => {
    const store = createStudioStore();
    store.getState().setStorageState({ worksInThisContext: false });
    const fn = vi.fn().mockResolvedValue(undefined);
    await tryPersist(store.getState(), fn);
    expect(fn).not.toHaveBeenCalled();
  });
});
