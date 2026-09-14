import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectCapabilities } from '../../src/lib/capabilities';

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
