/**
 * Feature probe run once on load. Populates the store's `capabilities` slice so tools and UI
 * can report `unsupported_in_this_browser` instead of throwing, and so the Skill/docs can be
 * precise about the browser floor per feature rather than per browser.
 */

export interface Capabilities {
  webgpu: boolean;
  webcodecs: boolean;
  opfs: boolean;
  fileSystemAccess: boolean;
  tabCapture: boolean;
  shareFiles: boolean;
}

export function detectCapabilities(): Capabilities {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as unknown as Record<string, unknown>);
  const win = typeof window === 'undefined' ? undefined : (window as unknown as Record<string, unknown>);

  const storage = nav?.storage as { getDirectory?: unknown } | undefined;
  const mediaDevices = nav?.mediaDevices as { getDisplayMedia?: unknown } | undefined;

  return {
    webgpu: !!nav?.gpu,
    webcodecs: typeof win?.VideoDecoder !== 'undefined',
    opfs: typeof storage?.getDirectory === 'function',
    fileSystemAccess: typeof win?.showOpenFilePicker === 'function',
    tabCapture: typeof mediaDevices?.getDisplayMedia === 'function',
    shareFiles: typeof nav?.canShare === 'function',
  };
}
