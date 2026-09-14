import { describe, expect, it, vi } from 'vitest';

const saveLastSourceMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../../src/store/library', () => ({
  readLibraryFile: vi.fn(async () => new File([new Uint8Array(4)], 'clip.mp4', { type: 'video/mp4' })),
  saveLastSource: saveLastSourceMock,
}));

import { DEFAULT_PROJECT_ID } from '../../src/lib/types';
import { loadSource } from '../../src/media/load';

describe('loadSource', () => {
  it('resolves the request, sets it as the active source, and persists it as the project last source', async () => {
    const setSource = vi.fn();
    const request = { kind: 'file' as const, id: 'a1' };

    await loadSource({ setSource }, request);

    expect(setSource).toHaveBeenCalledTimes(1);
    expect(setSource).toHaveBeenCalledWith(expect.objectContaining({ kind: 'file', assetId: 'a1' }));
    expect(saveLastSourceMock).toHaveBeenCalledWith(DEFAULT_PROJECT_ID, request);
  });

  it('does not persist the request when resolution fails', async () => {
    saveLastSourceMock.mockClear();
    const setSource = vi.fn();

    await expect(loadSource({ setSource }, { kind: 'file', id: undefined })).rejects.toThrow(/missing_id/);

    expect(setSource).not.toHaveBeenCalled();
    expect(saveLastSourceMock).not.toHaveBeenCalled();
  });
});
