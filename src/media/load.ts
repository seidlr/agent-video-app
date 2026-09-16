import { DEFAULT_PROJECT_ID } from '../lib/types';
import type { StudioState, StudioStore } from '../store/studio';
import { getLastSource, readLibraryFile, saveLastSource } from '../store/library';
import { tryPersist } from '../store/persist';
import { defaultSourceDeps, resolveSource, type SourceRequest } from './source';

/**
 * Resolves `request` and writes the result into the store as the active source. Shared by the
 * Library panel's "Open" buttons and Task 4's `load_video` tool -- both need the exact same
 * resolve-then-set-source behavior, so it lives here once instead of being duplicated.
 *
 * Also persists `request` as the project's last-loaded source (only once resolution succeeds --
 * a failed request, e.g. an unknown asset id, must not overwrite a previously working one) so
 * main.tsx can restore it on the next app boot without the user re-selecting it from the Library
 * (Task 3 DoD: "plays after a full page reload without re-selecting it").
 */
export async function loadSource(store: Pick<StudioState, 'setSource' | 'storage' | 'setStorageState'>, request: SourceRequest): Promise<void> {
  const deps = defaultSourceDeps(readLibraryFile);
  const resolved = await resolveSource(request, deps);
  store.setSource(resolved);
  await tryPersist(store, () => saveLastSource(DEFAULT_PROJECT_ID, request));
}

/**
 * Restores the project's last-loaded source on boot (Task 3 DoD) -- but only if nothing has
 * already loaded a source in the meantime. `getLastSource`'s IndexedDB read is a real async gap:
 * under real browser I/O contention (confirmed root cause of a CI-only failure in
 * tests/e2e/tools-playback.spec.ts's YouTube-narrowing test, reproducible on every run regardless
 * of timeout -- a prior "fix" and multiple timeout bumps there addressed a red herring) it can
 * resolve *after* a caller's own immediate `load_video` call already landed. Blindly applying the
 * restored value at that point would silently revert that newer load back to whatever was open
 * last session.
 */
export async function restoreLastSourceOnBoot(store: StudioStore, projectId: string): Promise<void> {
  const lastSource = await getLastSource(projectId);
  if (!lastSource || store.getState().source) return;
  await loadSource(store.getState(), lastSource).catch(() => undefined);
}
