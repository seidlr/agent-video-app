/**
 * OPFS byte storage: video files, thumbnail sprites, mattes. Streams via createWritable() on
 * Chrome/Edge/Firefox/Safari 26+; falls back to opfs.worker.ts's createSyncAccessHandle() on
 * Safari 15.2-25. Metadata (what a path *means*) lives in Dexie (db.ts) instead.
 */

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

function splitPath(path: string): { dirs: string[]; fileName: string } {
  const parts = path.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) throw new Error(`opfs: invalid path "${path}"`);
  return { dirs: parts, fileName };
}

async function getDir(
  root: FileSystemDirectoryHandle,
  dirs: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let dir = root;
  for (const part of dirs) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

function hasCreateWritable(
  handle: FileSystemFileHandle,
): handle is FileSystemFileHandle & { createWritable(): Promise<FileSystemWritableFileStream> } {
  return typeof (handle as unknown as { createWritable?: unknown }).createWritable === 'function';
}

let worker: Worker | null = null;
let requestId = 0;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./opfs.worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

function writeViaWorker(path: string, bytes: ArrayBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const id = ++requestId;
    const onMessage = (event: MessageEvent<{ id: number; ok: boolean; error?: string }>): void => {
      if (event.data.id !== id) return;
      w.removeEventListener('message', onMessage);
      if (event.data.ok) resolve();
      else reject(new Error(event.data.error ?? 'opfs worker write failed'));
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, path, bytes }, [bytes]);
  });
}

/** Writes `data` to `path`, creating parent directories as needed. */
export async function writeFile(path: string, data: Blob | ArrayBuffer | Uint8Array): Promise<void> {
  const root = await getRoot();
  const { dirs, fileName } = splitPath(path);
  const dir = await getDir(root, dirs, true);
  const fileHandle = await dir.getFileHandle(fileName, { create: true });

  if (hasCreateWritable(fileHandle)) {
    const writable = await fileHandle.createWritable();
    if (data instanceof Blob) {
      await data.stream().pipeTo(writable);
    } else {
      const view = data instanceof Uint8Array ? data : new Uint8Array(data);
      await writable.write(view.slice() as unknown as FileSystemWriteChunkType);
      await writable.close();
    }
    return;
  }

  const buffer = data instanceof Blob ? await data.arrayBuffer() : data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data;
  await writeViaWorker(path, buffer as ArrayBuffer);
}

/** Reads `path` back as a File. Throws if it does not exist. */
export async function readFile(path: string): Promise<File> {
  const root = await getRoot();
  const { dirs, fileName } = splitPath(path);
  const dir = await getDir(root, dirs, false);
  const fileHandle = await dir.getFileHandle(fileName, { create: false });
  return fileHandle.getFile();
}

/** Deletes `path`. Never throws for an already-missing file. */
export async function deleteFile(path: string): Promise<void> {
  const root = await getRoot();
  const { dirs, fileName } = splitPath(path);
  try {
    const dir = await getDir(root, dirs, false);
    await dir.removeEntry(fileName);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return;
    throw error;
  }
}

/** Lists entry names directly under `dirPath` (non-recursive). */
export async function list(dirPath: string): Promise<string[]> {
  const root = await getRoot();
  const dirs = dirPath.split('/').filter(Boolean);
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await getDir(root, dirs, false);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return [];
    throw error;
  }
  const names: string[] = [];
  // FileSystemDirectoryHandle is async-iterable in every OPFS-supporting browser.
  for await (const name of (dir as unknown as AsyncIterable<string>)) {
    names.push(name);
  }
  return names;
}
