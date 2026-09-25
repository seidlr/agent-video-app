import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { MODEL_CATALOG } from '../../ml/catalog';
import { mlClient } from '../../ml/client';
import { useStudio } from '../../store/studio';
import { ensureModelForUi } from '../ui/ensureModel';
import { SizeConfirm } from '../ui/SizeConfirm';

/** Every catalog model's cache/loaded state and load/unload controls, mirroring `list_models`/
 * `load_model`/`unload_model` (Task 7) -- the visual contract for "on demand, only when asked"
 * (Global Constraints): nothing here loads a model just by rendering, only a click does. */
export function Models(): ReactElement {
  const models = useStudio((s) => s.models);
  const setModelState = useStudio((s) => s.setModelState);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [sizesMB, setSizesMB] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    void mlClient.listModels().then((rows) => {
      for (const row of rows) {
        setModelState(row.id, { cached: row.cached, loaded: row.loaded, progress: row.loaded ? 1 : 0 });
      }
      setSizesMB(Object.fromEntries(rows.map((row) => [row.id, row.sizeMB])));
    });
  }, [setModelState]);

  async function handleLoad(id: string, confirmDownload: boolean): Promise<void> {
    setErrors((prev) => ({ ...prev, [id]: '' }));
    const result = await ensureModelForUi(id, { confirmDownload });
    if (!result.ok) {
      if (result.needsConfirm) {
        setConfirmingId(id);
      } else {
        setConfirmingId(null);
        setErrors((prev) => ({ ...prev, [id]: result.message }));
      }
      return;
    }
    setConfirmingId(null);
  }

  function handleUnload(id: string): void {
    mlClient.unloadModel(id);
    setModelState(id, { loaded: false, progress: 0 });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[12px] leading-snug text-ink-3">
        Models download only when you or your agent ask for them, then stay cached in this browser.
      </p>
      <div className="flex flex-col divide-y divide-line overflow-hidden rounded-token border border-line bg-surface">
        {MODEL_CATALOG.map((entry) => {
          const state = models[entry.id] ?? { cached: false, loaded: false, progress: 0 };
          const sizeMB = sizesMB[entry.id] ?? entry.approxMB;
          const statusLabel = state.loaded ? 'loaded' : state.cached ? 'cached' : 'not loaded';
          const statusClass = state.loaded ? 'bg-good-soft text-good' : state.cached ? 'bg-chip text-ink-2' : 'bg-surface-2 text-ink-3';
          const loading = state.progress > 0 && state.progress < 1;

          return (
            <div key={entry.id} className="flex flex-col gap-1 px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <div className="min-w-0 flex-1 truncate text-[12.5px] font-medium" title={entry.id}>
                  {entry.id}
                </div>
                <span className={`flex-none rounded px-1.5 py-0.5 font-mono text-[10px] ${statusClass}`}>{statusLabel}</span>
                {confirmingId !== entry.id &&
                  (state.loaded ? (
                    <button
                      type="button"
                      onClick={() => handleUnload(entry.id)}
                      className="flex-none rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink-2 hover:bg-surface-2"
                    >
                      Unload
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => void handleLoad(entry.id, false)}
                      className="flex-none rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink-2 hover:bg-surface-2 disabled:opacity-50"
                    >
                      Load
                    </button>
                  ))}
              </div>

              <div className="font-mono text-[10.5px] text-ink-3">
                {entry.family} · {entry.device} · <span className="tabular-nums">{sizeMB < 10 ? sizeMB.toFixed(1) : Math.round(sizeMB)} MB</span> · {entry.license}
              </div>

              {loading && (
                <div className="h-1 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full bg-clay transition-[width]" style={{ width: `${state.progress * 100}%` }} />
                </div>
              )}

              {errors[entry.id] && (
                <p role="alert" className="text-[11.5px] text-clay-ink">
                  {errors[entry.id]}
                </p>
              )}

              {confirmingId === entry.id && (
                <SizeConfirm sizeMB={sizeMB} label={entry.id} onConfirm={() => void handleLoad(entry.id, true)} onCancel={() => setConfirmingId(null)} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
