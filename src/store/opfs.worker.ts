/// <reference lib="webworker" />
/**
 * Fallback writer for browsers without FileSystemFileHandle.createWritable() (Safari 15.2–25):
 * createSyncAccessHandle() is worker-only, so the write is dispatched here.
 */

export interface OpfsWorkerRequest {
  id: number;
  path: string;
  bytes: ArrayBuffer;
}

export interface OpfsWorkerResponse {
  id: number;
  ok: boolean;
  error?: string;
}

self.addEventListener('message', (event: MessageEvent<OpfsWorkerRequest>) => {
  void handle(event.data);
});

async function handle(req: OpfsWorkerRequest): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const parts = req.path.split('/').filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) throw new Error('empty path');

    let dir = root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    // Sync access handle is the Safari 15.2-25 fallback; TS lib.dom doesn't type it yet.
    const accessHandle = await (
      fileHandle as unknown as { createSyncAccessHandle(): Promise<FileSystemSyncAccessHandleLike> }
    ).createSyncAccessHandle();

    accessHandle.truncate(0);
    accessHandle.write(new Uint8Array(req.bytes), { at: 0 });
    accessHandle.flush();
    accessHandle.close();

    const response: OpfsWorkerResponse = { id: req.id, ok: true };
    (self as unknown as Worker).postMessage(response);
  } catch (error) {
    const response: OpfsWorkerResponse = {
      id: req.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    (self as unknown as Worker).postMessage(response);
  }
}

interface FileSystemSyncAccessHandleLike {
  truncate(size: number): void;
  write(buffer: Uint8Array, options?: { at: number }): number;
  flush(): void;
  close(): void;
}
