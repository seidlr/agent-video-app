import type { Asset, AssetKind } from '../lib/types';
import { db, type ProjectRow } from './db';
import { deleteFile, readFile, writeFile } from './opfs';

function nextAssetId(): string {
  return `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? 'bin' : fileName.slice(dot + 1).toLowerCase();
}

/**
 * Streams `file` into OPFS and records an Asset row. Duration/width/height/fps start at 0 --
 * they are unknown until the player reports them via updateAssetMetadata (Task 3's VideoStage
 * onLoadedMetadata) or, more precisely, Task 5's mediabunny-based probe.
 */
export async function importFile(file: File, projectId: string): Promise<Asset> {
  const id = nextAssetId();
  const opfsPath = `projects/${projectId}/media/${id}.${extensionOf(file.name)}`;

  try {
    await writeFile(opfsPath, file);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      throw new Error('storage_quota_exceeded: not enough space to store this file');
    }
    throw error;
  }

  const asset: Asset = {
    id,
    projectId,
    kind: 'file',
    name: file.name,
    opfsPath,
    duration: 0,
    width: 0,
    height: 0,
    fps: 0,
    bytes: file.size,
    createdAt: Date.now(),
  };

  try {
    await db.assets.put(asset);
  } catch (error) {
    // Roll back the OPFS write if the metadata record failed, so we never leak an orphaned file.
    await deleteFile(opfsPath).catch(() => undefined);
    throw error;
  }

  return asset;
}

export async function listLibraryAssets(projectId: string): Promise<Asset[]> {
  const assets = await db.assets.where('projectId').equals(projectId).toArray();
  return assets.sort((a, b) => b.createdAt - a.createdAt);
}

export async function updateAssetMetadata(
  assetId: string,
  patch: Partial<Pick<Asset, 'duration' | 'width' | 'height' | 'fps'>>,
): Promise<void> {
  await db.assets.update(assetId, patch);
}

export async function readLibraryFile(assetId: string): Promise<File> {
  const asset = await db.assets.get(assetId);
  if (!asset?.opfsPath) throw new Error(`unknown_asset: no library asset with id "${assetId}"`);
  const raw = await readFile(asset.opfsPath);
  // opfs.ts stores bytes at `<id>.<ext>`, so the raw File's own .name is that internal path's
  // basename, not what the user uploaded -- re-wrap with the Asset's original name (used as the
  // player/breadcrumb title via resolveSource's file branch) without re-reading the bytes.
  return new File([raw], asset.name, { type: raw.type });
}

export async function removeLibraryAsset(assetId: string): Promise<void> {
  const asset = await db.assets.get(assetId);
  if (asset?.opfsPath) {
    await deleteFile(asset.opfsPath);
  }
  await db.assets.delete(assetId);
}

/**
 * Records `request` as the project's last-loaded source, creating the project row on first use
 * (mirrors the projects table's `theme` field, which is likewise absent until first written).
 * Read back by getLastSource() on app boot to restore the video across a full page reload
 * without the user re-selecting it (Task 3 DoD).
 */
export async function saveLastSource(projectId: string, request: { kind: AssetKind; id?: string; url?: string }): Promise<void> {
  const existing = await db.projects.get(projectId);
  const row: ProjectRow = {
    id: projectId,
    name: existing?.name ?? 'Default Project',
    theme: existing?.theme ?? 'system',
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    lastSource: request,
  };
  await db.projects.put(row);
}

export async function getLastSource(projectId: string): Promise<ProjectRow['lastSource']> {
  const row = await db.projects.get(projectId);
  return row?.lastSource;
}
