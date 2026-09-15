import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { MODEL_CATALOG } from '../../ml/catalog';
import { mlClient } from '../../ml/client';
import { useStudio } from '../../store/studio';
import { SizeConfirm } from '../ui/SizeConfirm';

/** Every catalog model's cache/loaded state and load/unload controls, mirroring `list_models`/
 * `load_model`/`unload_model` (Task 7) -- the visual contract for "on demand, only when asked"
 * (Global Constraints): nothing here loads a model just by rendering, only a click does. */
export function Models(): ReactElement {
  const models = useStudio((s) => s.models);
  const setModelState = useStudio((s) => s.setModelState);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [sizesMB, setSizesMB] = useState<Record<string, number>>({});

  useEffect(() => {
    void mlClient.listModels().then((rows) => {
      for (const row of rows) {
        setModelState(row.id, { cached: row.cached, loaded: row.loaded, progress: row.loaded ? 1 : 0 });
      }
      setSizesMB(Object.fromEntries(rows.map((row) => [row.id, row.sizeMB])));
    });
  }, [setModelState]);

  async function handleLoad(id: string, confirmDownload: boolean): Promise<void> {
    const result = await mlClient.ensureModel(id, { confirmDownload, onProgress: (fraction) => setModelState(id, { progress: fraction }) });
    if (!result.ok) {
      if (result.error === 'model_not_loaded') setConfirmingId(id);
      return;
    }
    setConfirmingId(null);
    setModelState(id, { loaded: true, cached: true, progress: 1 });
  }

  function handleUnload(id: string): void {
    mlClient.unloadModel(id);
    setModelState(id, { loaded: false, progress: 0 });
  }

  return (
    <div className="flex flex-col gap-2">
      {MODEL_CATALOG.map((entry) => {
        const state = models[entry.id] ?? { cached: false, loaded: false, progress: 0 };
        const sizeMB = sizesMB[entry.id] ?? entry.approxMB;
        const statusLabel = state.loaded ? 'loaded' : state.cached ? 'cached' : 'not loaded';
        const statusClass = state.loaded ? 'bg-good-soft text-good' : state.cached ? 'bg-chip text-ink-2' : 'bg-surface-2 text-ink-3';

        return (
          <div key={entry.id} className="rounded-token border border-line bg-surface-2 p-2.5 text-[12.5px]">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{entry.id}</div>
                <div className="truncate text-[11px] text-ink-3">
                  {entry.family} · {sizeMB} MB · {entry.license} · {entry.device}
                </div>
              </div>
              <span className={`flex-none rounded px-1.5 py-0.5 font-mono text-[10.5px] ${statusClass}`}>{statusLabel}</span>
            </div>

            {state.progress > 0 && state.progress < 1 && (
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface">
                <div className="h-full bg-clay transition-[width]" style={{ width: `${state.progress * 100}%` }} />
              </div>
            )}

            {confirmingId === entry.id ? (
              <div className="mt-1.5">
                <SizeConfirm sizeMB={sizeMB} label={entry.id} onConfirm={() => void handleLoad(entry.id, true)} onCancel={() => setConfirmingId(null)} />
              </div>
            ) : (
              <div className="mt-1.5">
                {state.loaded ? (
                  <button type="button" onClick={() => handleUnload(entry.id)} className="rounded px-2 py-1 text-ink-2 hover:bg-line">
                    Unload
                  </button>
                ) : (
                  <button type="button" onClick={() => void handleLoad(entry.id, false)} className="rounded px-2 py-1 text-ink-2 hover:bg-line">
                    Load
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
