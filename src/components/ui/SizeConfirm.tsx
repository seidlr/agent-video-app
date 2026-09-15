import type { ReactElement } from 'react';

export interface SizeConfirmProps {
  sizeMB: number;
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Shown wherever a tool/UI action would trigger `ensureModel(id, {confirmDownload:false})`'s
 * `model_not_loaded` result -- the plan's "size confirm dialog," a human-facing counterpart to an
 * agent re-calling the same tool with `confirmDownload:true` once it has read the size. */
export function SizeConfirm({ sizeMB, label, onConfirm, onCancel }: SizeConfirmProps): ReactElement {
  return (
    <div className="flex flex-col gap-1.5 rounded-token border border-line bg-surface p-2 text-[12px]">
      <p>
        Download <b>{label}</b> (~{sizeMB} MB) to enable this?
      </p>
      <div className="flex gap-1.5">
        <button type="button" onClick={onConfirm} className="rounded-token bg-ink px-2.5 py-1 font-medium text-surface">
          Download
        </button>
        <button type="button" onClick={onCancel} className="rounded-token bg-surface-2 px-2.5 py-1 text-ink-2 hover:bg-line">
          Cancel
        </button>
      </div>
    </div>
  );
}
