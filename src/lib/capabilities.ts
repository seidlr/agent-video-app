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

/**
 * The MCP App's own storage probe (Key Decisions: "on MCP App boot try `indexedDB.open` +
 * `navigator.storage.getDirectory()`; ... disable persistence when either throws"), run once at
 * boot by `mcpApp.ts` only -- unlike `detectCapabilities()`'s synchronous `typeof x === 'function'`
 * checks (accurate for the main site, where these APIs reliably work whenever they exist), a
 * sandboxed MCP App iframe can have `navigator.storage.getDirectory` *present* as a function yet
 * throw a real `SecurityError` the moment it's actually called (e.g. a stricter Permissions
 * Policy than the main site ever encounters) -- only calling it proves anything. IndexedDB
 * (Dexie's own underlying store, used for notes/chapters/boxes/etc., not just OPFS video bytes)
 * is checked the same way since MCP Apps run in a similarly permission-gated context.
 */
export async function probeStorageWorks(): Promise<boolean> {
  const [idb, opfs] = await Promise.all([probeIndexedDb(), probeOpfsDirectory()]);
  return idb && opfs;
}

function probeIndexedDb(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open('__agent_video_studio_storage_probe__');
      request.onsuccess = () => {
        request.result.close();
        indexedDB.deleteDatabase('__agent_video_studio_storage_probe__');
        resolve(true);
      };
      request.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function probeOpfsDirectory(): Promise<boolean> {
  const storage = (navigator as unknown as { storage?: { getDirectory?: () => Promise<unknown> } }).storage;
  if (typeof storage?.getDirectory !== 'function') return false;
  try {
    await storage.getDirectory();
    return true;
  } catch {
    return false;
  }
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
