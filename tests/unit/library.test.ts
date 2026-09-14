import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const opfsMock = vi.hoisted(() => ({
  writeFile: vi.fn(async () => undefined),
  // Mirrors the real OPFS layer: the file on disk is named after its internal asset id, not the
  // original upload -- readLibraryFile must restore the Asset's own `name` (see the test below).
  readFile: vi.fn(async () => new File([new Uint8Array(4)], 'asset-internal-name.mp4', { type: 'video/mp4' })),
  deleteFile: vi.fn(async () => undefined),
}));
vi.mock('../../src/store/opfs', () => opfsMock);

import { db } from '../../src/store/db';
import {
  getLastSource,
  importFile,
  listLibraryAssets,
  readLibraryFile,
  removeLibraryAsset,
  saveLastSource,
  updateAssetMetadata,
} from '../../src/store/library';

describe('library', () => {
  const PROJECT_ID = 'p1';

  beforeEach(() => {
    opfsMock.writeFile.mockClear();
    opfsMock.readFile.mockClear();
    opfsMock.deleteFile.mockClear();
  });

  afterEach(async () => {
    await db.assets.clear();
    await db.projects.clear();
  });

  it('importFile writes bytes to OPFS and records an asset in Dexie', async () => {
    const file = new File([new Uint8Array(1024)], 'my clip.mp4', { type: 'video/mp4' });
    const asset = await importFile(file, PROJECT_ID);

    expect(asset.kind).toBe('file');
    expect(asset.name).toBe('my clip.mp4');
    expect(asset.projectId).toBe(PROJECT_ID);
    expect(asset.bytes).toBe(1024);
    // Duration/dimensions/fps are unknown until the player's onLoadedMetadata reports them
    // (see updateAssetMetadata below) -- src/media/input.ts (Task 5) probes them precisely.
    expect(asset.duration).toBe(0);
    expect(asset.opfsPath).toMatch(new RegExp(`^projects/${PROJECT_ID}/media/${asset.id}\\.mp4$`));

    expect(opfsMock.writeFile).toHaveBeenCalledWith(asset.opfsPath, file);

    const stored = await db.assets.get(asset.id);
    expect(stored).toEqual(asset);
  });

  it('updateAssetMetadata patches duration/dimensions/fps once the player reports them', async () => {
    const file = new File([new Uint8Array(16)], 'clip.mp4', { type: 'video/mp4' });
    const asset = await importFile(file, PROJECT_ID);

    await updateAssetMetadata(asset.id, { duration: 8, width: 640, height: 360, fps: 30 });
    const stored = await db.assets.get(asset.id);
    expect(stored).toMatchObject({ duration: 8, width: 640, height: 360, fps: 30 });
  });

  it('listLibraryAssets returns only assets for the given project, newest first', async () => {
    await db.assets.bulkPut([
      { id: 'a1', projectId: PROJECT_ID, kind: 'file', name: 'old', duration: 1, width: 1, height: 1, fps: 30, bytes: 1, createdAt: 100 },
      { id: 'a2', projectId: PROJECT_ID, kind: 'file', name: 'new', duration: 1, width: 1, height: 1, fps: 30, bytes: 1, createdAt: 200 },
      { id: 'a3', projectId: 'other-project', kind: 'file', name: 'other', duration: 1, width: 1, height: 1, fps: 30, bytes: 1, createdAt: 300 },
    ]);
    const assets = await listLibraryAssets(PROJECT_ID);
    expect(assets.map((a) => a.id)).toEqual(['a2', 'a1']);
  });

  it('removeLibraryAsset deletes both the OPFS bytes and the Dexie row', async () => {
    await db.assets.put({
      id: 'a1',
      projectId: PROJECT_ID,
      kind: 'file',
      name: 'clip.mp4',
      opfsPath: 'projects/p1/media/a1.mp4',
      duration: 1,
      width: 1,
      height: 1,
      fps: 30,
      bytes: 1,
      createdAt: 0,
    });
    await removeLibraryAsset('a1');
    expect(opfsMock.deleteFile).toHaveBeenCalledWith('projects/p1/media/a1.mp4');
    expect(await db.assets.get('a1')).toBeUndefined();
  });

  it('readLibraryFile restores the asset\'s original filename, not the OPFS-internal one', async () => {
    await db.assets.put({
      id: 'a1',
      projectId: PROJECT_ID,
      kind: 'file',
      name: 'my original clip.mp4',
      opfsPath: 'projects/p1/media/a1.mp4',
      duration: 1,
      width: 1,
      height: 1,
      fps: 30,
      bytes: 1,
      createdAt: 0,
    });
    const file = await readLibraryFile('a1');
    expect(file.name).toBe('my original clip.mp4');
    expect(file.type).toBe('video/mp4');
    expect(opfsMock.readFile).toHaveBeenCalledWith('projects/p1/media/a1.mp4');
  });

  it('readLibraryFile throws a descriptive error for an unknown asset', async () => {
    await expect(readLibraryFile('missing')).rejects.toThrow(/unknown_asset/);
  });

  it('getLastSource returns undefined when no project row exists yet', async () => {
    expect(await getLastSource(PROJECT_ID)).toBeUndefined();
  });

  it('saveLastSource then getLastSource round-trips the request, creating the project row', async () => {
    await saveLastSource(PROJECT_ID, { kind: 'file', id: 'a1' });
    expect(await getLastSource(PROJECT_ID)).toEqual({ kind: 'file', id: 'a1' });
  });

  it('saveLastSource overwrites a previous request without clobbering other project fields', async () => {
    await db.projects.put({ id: PROJECT_ID, name: 'My Project', theme: 'dark', createdAt: 1, updatedAt: 1 });
    await saveLastSource(PROJECT_ID, { kind: 'youtube', url: 'https://youtu.be/abc' });
    const row = await db.projects.get(PROJECT_ID);
    expect(row).toMatchObject({ name: 'My Project', theme: 'dark', createdAt: 1, lastSource: { kind: 'youtube', url: 'https://youtu.be/abc' } });
  });
});
