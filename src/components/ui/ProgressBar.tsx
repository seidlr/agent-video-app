import type { ReactElement } from 'react';

export interface ProgressBarProps {
  /** 0..1. */
  value: number;
  label?: string;
}

export function ProgressBar({ value, label }: ProgressBarProps): ReactElement {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="flex flex-col gap-1">
      {label && <span className="font-mono text-[10.5px] text-ink-3">{label}</span>}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
      >
        <div className="h-full rounded-full bg-clay transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
