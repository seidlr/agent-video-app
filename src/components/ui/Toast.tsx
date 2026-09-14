import { useEffect } from 'react';
import type { ReactElement } from 'react';

export interface ToastProps {
  message: string;
  tone?: 'default' | 'warn' | 'error';
  onDismiss: () => void;
  autoDismissMs?: number;
}

const TONE_CLASSES: Record<NonNullable<ToastProps['tone']>, string> = {
  default: 'bg-ink text-surface',
  warn: 'bg-warn text-surface',
  error: 'bg-clay-ink text-surface',
};

export function Toast({ message, tone = 'default', onDismiss, autoDismissMs = 5000 }: ToastProps): ReactElement {
  useEffect(() => {
    if (!autoDismissMs) return;
    const t = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(t);
  }, [autoDismissMs, onDismiss]);

  return (
    <div
      role="status"
      className={`flex items-center gap-3 rounded-token px-3.5 py-2.5 text-[13px] shadow-lg ${TONE_CLASSES[tone]}`}
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="rounded px-1 text-xs opacity-70 hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}
