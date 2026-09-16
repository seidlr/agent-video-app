/**
 * Storage persistence + quota helpers. Called on first asset import (see src/store/library.ts,
 * Task 3): if the browser denies persist(), studioStore.storage.persisted stays false and the
 * UI shows the eviction-risk banner (Task 3).
 */
import type { StudioState } from './studio';

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

/**
 * Task 11's own "skip OPFS/Dexie when the probe fails" gap, closed: wraps a Dexie/OPFS
 * persistence call so a storage-unavailable host (`storage.worksInThisContext`, set once by the
 * MCP App's boot-time probe in `agent/mcpApp.ts`) never aborts the calling tool's own successful
 * result. Before this, every one of these calls was `await`ed directly with no try/catch, so a
 * real thrown `SecurityError` (or any other storage failure) propagated straight through the tool
 * handler that awaited it -- caught only by the registry's own generic `callDirect`/`callJob`
 * wrapper, which then returned `{ok:false, error:'tool_threw', ...}` even when the tool's own
 * actual, visible effect (the video loaded, the frame appeared, the box was drawn) had already
 * fully succeeded in memory. `load_video` was the worst case: a broken host would make every
 * single call report failure to the calling agent despite the video visibly loading and playing.
 * Skips immediately once storage is already known-unavailable (no repeated doomed I/O attempts);
 * degrades gracefully -- flips the flag and swallows the error -- the first time a call
 * unexpectedly throws instead of ever propagating past the tool handler that awaited it.
 */
export async function tryPersist(state: Pick<StudioState, 'storage' | 'setStorageState'>, fn: () => Promise<unknown>): Promise<void> {
  if (!state.storage.worksInThisContext) return;
  try {
    await fn();
  } catch {
    state.setStorageState({ worksInThisContext: false });
  }
}
