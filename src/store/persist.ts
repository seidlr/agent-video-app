/**
 * Storage persistence + quota helpers. Called on first asset import (see src/store/library.ts,
 * Task 3): if the browser denies persist(), studioStore.storage.persisted stays false and the
 * UI shows the eviction-risk banner (Task 3).
 */

interface StorageLike {
  persisted?(): Promise<boolean>;
  persist?(): Promise<boolean>;
  estimate?(): Promise<{ usage?: number; quota?: number }>;
}

function getStorage(): StorageLike | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as { storage?: StorageLike }).storage;
}

/** Requests persistent storage if not already granted. Never throws. */
export async function ensurePersisted(): Promise<boolean> {
  const storage = getStorage();
  if (!storage?.persisted || !storage.persist) return false;
  try {
    if (await storage.persisted()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

/** Reads current usage/quota. Returns zeros (not a throw) where estimate() is unavailable. */
export async function readStorageEstimate(): Promise<{ usage: number; quota: number }> {
  const storage = getStorage();
  if (!storage?.estimate) return { usage: 0, quota: 0 };
  try {
    const { usage = 0, quota = 0 } = await storage.estimate();
    return { usage, quota };
  } catch {
    return { usage: 0, quota: 0 };
  }
}
