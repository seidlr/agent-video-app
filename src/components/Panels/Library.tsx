import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, ReactElement } from 'react';
import { FolderInput, Trash2, Upload } from 'lucide-react';
import { secsToTimecode } from '../../lib/time';
import { DEFAULT_PROJECT_ID } from '../../lib/types';
import type { Asset } from '../../lib/types';
import { loadSource } from '../../media/load';
import { applyImportedProject, parseProjectZip } from '../../media/project';
import type { SampleCatalogEntry } from '../../media/source';
import { readStorageEstimate } from '../../store/persist';
import { ensurePersisted } from '../../store/persist';
import { importFile, listLibraryAssets, removeLibraryAsset } from '../../store/library';
import { studioStore, useStudio } from '../../store/studio';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** exp).toFixed(exp === 0 ? 0 : 1)} ${units[exp]}`;
}

export function Library(): ReactElement {
  const [samples, setSamples] = useState<SampleCatalogEntry[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [storageEstimate, setStorageEstimate] = useState({ usage: 0, quota: 0 });
  const [persisted, setPersisted] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);

  const currentSourceTitle = useStudio((s) => s.source?.title);

  async function refreshAssets(): Promise<void> {
    setAssets(await listLibraryAssets(DEFAULT_PROJECT_ID));
    setStorageEstimate(await readStorageEstimate());
  }

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}samples/index.json`)
      .then((r) => r.json())
      .then((data: { samples: SampleCatalogEntry[] }) => setSamples(data.samples))
      .catch(() => setSamples([]));
    void refreshAssets();
  }, []);

  async function handleFiles(files: FileList | null): Promise<void> {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    try {
      const asset = await importFile(file, DEFAULT_PROJECT_ID);
      const persistedNow = await ensurePersisted();
      setPersisted(persistedNow);
      await refreshAssets();
      await loadSource(studioStore.getState(), { kind: 'file', id: asset.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import this file');
    }
  }

  async function handleImportProject(files: FileList | null): Promise<void> {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    setImportMessage(null);
    try {
      const parsed = await parseProjectZip(file);
      await applyImportedProject(studioStore, parsed);
      setImportMessage(
        `Imported ${parsed.manifest.notes.length} note(s), ${parsed.manifest.chapters.length} chapter(s), ${parsed.manifest.boxes.length} box(es), ${parsed.manifest.clips.length} clip(s), ${parsed.manifest.frames.length} frame(s).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import this project');
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setDragActive(false);
    void handleFiles(e.dataTransfer.files);
  }

  async function openSample(id: string): Promise<void> {
    await loadSource(studioStore.getState(), { kind: 'sample', id });
  }

  async function openAsset(id: string): Promise<void> {
    await loadSource(studioStore.getState(), { kind: 'file', id });
  }

  async function removeAsset(id: string): Promise<void> {
    await removeLibraryAsset(id);
    await refreshAssets();
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-token-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${dragActive ? 'border-clay bg-clay-soft' : 'border-line-2 bg-surface'}`}
      >
        <div className="mb-1 grid h-9 w-9 place-items-center rounded-token bg-surface-2 text-ink-3">
          <Upload size={16} />
        </div>
        <b className="text-sm">Drop a video file, or click to browse</b>
        <span className="text-xs text-ink-3">Stored locally in this browser, never uploaded</span>
        {/* Visually hidden (not display:none) so agent-driven file_upload tools can still target it. */}
        <input
          id="video-file"
          ref={fileInputRef}
          type="file"
          accept="video/*"
          onChange={(e: ChangeEvent<HTMLInputElement>) => void handleFiles(e.target.files)}
          className="absolute h-px w-px overflow-hidden opacity-0"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      {error && <p className="text-xs text-clay-ink">{error}</p>}

      {samples.length > 0 && (
        <div>
          <h3 className="mb-2 text-[13px] font-semibold">Sample library</h3>
          <div className="flex flex-col gap-1.5">
            {samples.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => void openSample(s.id)}
                className={`flex items-center gap-2.5 rounded-token bg-surface-2 p-2 text-left text-[12.5px] transition-colors hover:bg-line ${currentSourceTitle === s.title ? 'ring-1 ring-clay' : ''}`}
              >
                <div className="h-7 w-11 flex-none rounded bg-gradient-to-br from-ink-2 to-ink" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{s.title}</div>
                  <div className="text-ink-3">{secsToTimecode(s.duration)} · {s.width}x{s.height}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-[13px] font-semibold">Your videos</h3>
        {assets.length === 0 ? (
          <p className="text-xs text-ink-3">Nothing uploaded yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {assets.map((a) => (
              <div
                key={a.id}
                className={`flex items-center gap-2.5 rounded-token bg-surface-2 p-2 text-[12.5px] ${currentSourceTitle === a.name ? 'ring-1 ring-clay' : ''}`}
              >
                <button type="button" onClick={() => void openAsset(a.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                  <div className="h-7 w-11 flex-none rounded bg-gradient-to-br from-ink-2 to-ink" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{a.name}</div>
                    <div className="text-ink-3">
                      {a.duration > 0 ? `${secsToTimecode(a.duration)} · ` : ''}{formatBytes(a.bytes)}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => void removeAsset(a.id)}
                  aria-label={`Remove ${a.name}`}
                  className="grid h-6 w-6 flex-none place-items-center rounded text-ink-3 hover:bg-line hover:text-clay-ink"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-line pt-3">
        <button
          type="button"
          onClick={() => projectInputRef.current?.click()}
          className="flex items-center gap-1.5 rounded-token border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink-2 hover:bg-surface-2"
        >
          <FolderInput size={13} />
          Import project
        </button>
        <input
          id="project-file"
          ref={projectInputRef}
          type="file"
          accept=".zip,application/zip"
          onChange={(e: ChangeEvent<HTMLInputElement>) => void handleImportProject(e.target.files)}
          className="absolute h-px w-px overflow-hidden opacity-0"
        />
        {importMessage && <p className="mt-1.5 text-[11px] text-ink-3">{importMessage}</p>}
      </div>

      <div className="mt-2 border-t border-line pt-3 text-[11px] text-ink-3">
        {storageEstimate.quota > 0 && (
          <div>
            {formatBytes(storageEstimate.usage)} of {formatBytes(storageEstimate.quota)} used
          </div>
        )}
        {!persisted && (
          <p className="mt-1 text-warn">
            Your browser may clear these videos if you don&apos;t come back for a while or the disk fills up. Export the project to keep a copy.
          </p>
        )}
      </div>
    </div>
  );
}
