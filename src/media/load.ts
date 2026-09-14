import { DEFAULT_PROJECT_ID } from '../lib/types';
import type { StudioState } from '../store/studio';
import { readLibraryFile, saveLastSource } from '../store/library';
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
export async function loadSource(store: Pick<StudioState, 'setSource'>, request: SourceRequest): Promise<void> {
  const deps = defaultSourceDeps(readLibraryFile);
  const resolved = await resolveSource(request, deps);
  store.setSource(resolved);
  await saveLastSource(DEFAULT_PROJECT_ID, request);
}
