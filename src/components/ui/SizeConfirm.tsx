import { useState } from 'react';
import type { ReactElement } from 'react';
import { useStudio } from '../../store/studio';

export interface SizeConfirmProps {
  sizeMB: number;
  /** The model's catalog id -- also the key its live download progress is published under
   * (`models[label].progress`, written by ensureModel.ts). */
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Shown wherever a tool/UI action would trigger `ensureModel(id, {confirmDownload:false})`'s
 * `model_not_loaded` result -- the plan's "size confirm dialog," a human-facing counterpart to an
 * agent re-calling the same tool with `confirmDownload:true` once it has read the size.
 *
 * Once "Download" is clicked it swaps to a live "Downloading… N%" readout until the caller unmounts
 * it (on success or failure): the download takes seconds to minutes, and an unchanged dialog after a
 * click reads as "the button does nothing". There is no cancel while a download is in flight --
 * ml/client.ts has no abort path for a worker mid-load. */
export function SizeConfirm({ sizeMB, label, onConfirm, onCancel }: SizeConfirmProps): ReactElement {
  const [started, setStarted] = useState(false);
  const progress = useStudio((s) => s.models[label]?.progress ?? 0);
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);

  if (started) {
    return (
      <div className="flex flex-col gap-1.5 rounded-token border border-line bg-surface p-2 text-[12px]" role="status" aria-live="polite">
        <p>
          Downloading <b>{label}</b> (~{sizeMB} MB)… {percent > 0 ? `${percent}%` : 'starting'}
        </p>
        <div
          role="progressbar"
          aria-label={`Downloading ${label}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1 overflow-hidden rounded-full bg-surface-2"
        >
          <div className="h-full bg-clay transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-token border border-line bg-surface p-2 text-[12px]">
      <p>
        Download <b>{label}</b> (~{sizeMB} MB) to enable this?
      </p>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => {
            setStarted(true);
            onConfirm();
          }}
          className="rounded-token bg-ink px-2.5 py-1 font-medium text-surface"
        >
          Download
        </button>
        <button type="button" onClick={onCancel} className="rounded-token bg-surface-2 px-2.5 py-1 text-ink-2 hover:bg-line">
          Cancel
        </button>
      </div>
    </div>
  );
}
