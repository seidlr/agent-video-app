import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectCapabilities, probeStorageWorks } from '../../src/lib/capabilities';

/** A minimal fake mimicking the real IDBOpenDBRequest's onsuccess/onerror callback contract --
 * probeStorageWorks() only ever touches `result.close()`, `onsuccess`, and `onerror`. */
function fakeIndexedDb(behavior: 'succeed' | 'error' | 'throw-sync') {
  return {
    open: () => {
      if (behavior === 'throw-sync') throw new Error('blocked by sandbox');
      const request: { onsuccess: (() => void) | null; onerror: (() => void) | null; result: { close(): void } } = {
        onsuccess: null,
        onerror: null,
        result: { close: () => undefined },
      };
      queueMicrotask(() => {
        if (behavior === 'succeed') request.onsuccess?.();
        else request.onerror?.();
      });
      return request;
    },
    deleteDatabase: () => undefined,
  };
}

describe('detectCapabilities', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports false for everything when no browser APIs are present', () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', {});
    const caps = detectCapabilities();
    expect(caps).toEqual({
      webgpu: false,
      webcodecs: false,
      opfs: false,
      fileSystemAccess: false,
      tabCapture: false,
      shareFiles: false,
    });
  });

  it('detects each API independently when present', () => {
    vi.stubGlobal('navigator', {
      gpu: {},
      storage: { getDirectory: () => undefined },
      mediaDevices: { getDisplayMedia: () => undefined },
      canShare: () => true,
    });
    vi.stubGlobal('window', {
      VideoDecoder: class {},
      showOpenFilePicker: () => undefined,
    });
    const caps = detectCapabilities();
    expect(caps).toEqual({
      webgpu: true,
      webcodecs: true,
      opfs: true,
      fileSystemAccess: true,
      tabCapture: true,
      shareFiles: true,
    });
  });
});

describe('probeStorageWorks (Task 11: the MCP App boot-time storage probe)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves true when both indexedDB.open and storage.getDirectory actually succeed', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDb('succeed'));
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({}) } });
    await expect(probeStorageWorks()).resolves.toBe(true);
  });

  it('resolves false when indexedDB.open reports an error, even though storage.getDirectory works', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDb('error'));
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({}) } });
    await expect(probeStorageWorks()).resolves.toBe(false);
  });

  it('resolves false when storage.getDirectory throws, even though indexedDB.open works', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDb('succeed'));
    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: async () => {
          throw new DOMException('denied by sandbox', 'SecurityError');
        },
      },
    });
    await expect(probeStorageWorks()).resolves.toBe(false);
  });

  it('resolves false without throwing when indexedDB.open itself throws synchronously', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDb('throw-sync'));
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({}) } });
    await expect(probeStorageWorks()).resolves.toBe(false);
  });

  it('resolves false when indexedDB is entirely undefined (a stricter sandbox than typeof-checks alone would catch)', async () => {
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({}) } });
    await expect(probeStorageWorks()).resolves.toBe(false);
  });
});
