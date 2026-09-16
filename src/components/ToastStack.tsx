import { useEffect, useRef, useState, type ReactElement } from 'react';
import { describeToolCall } from '../agent/activity';
import type { ToolCall } from '../lib/types';
import { useStudio } from '../store/studio';

const DISMISS_AFTER_MS = 4000;

const DOT_COLOR: Record<ToolCall['status'], string> = {
  running: 'bg-warn',
  done: 'bg-good',
  error: 'bg-clay-ink',
};

/**
 * Ambient "what did the agent just do" notification, visible from any panel tab -- the Activity
 * feed itself only shows once that tab is open, so a tool call otherwise passes silently while an
 * agent works and the user is looking at Notes/Frames/whatever else. One toast per tool call,
 * updating in place from "running…" to "done"/"failed", then auto-dismissing.
 */
export function ToastStack(): ReactElement | null {
  const activity = useStudio((s) => s.activity);
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    for (const call of activity) {
      setVisibleIds((ids) => (ids.includes(call.id) ? ids : [...ids, call.id]));
      if (call.status !== 'running' && !timers.current.has(call.id)) {
        const timer = setTimeout(() => {
          setVisibleIds((ids) => ids.filter((id) => id !== call.id));
          timers.current.delete(call.id);
        }, DISMISS_AFTER_MS);
        timers.current.set(call.id, timer);
      }
    }
  }, [activity]);

  useEffect(() => {
    const scheduled = timers.current;
    return () => {
      for (const timer of scheduled.values()) clearTimeout(timer);
    };
  }, []);

  const toasts = visibleIds.map((id) => activity.find((call) => call.id === id)).filter((call): call is ToolCall => call !== undefined);
  if (toasts.length === 0) return null;

  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-1.5">
      {toasts.map((call) => (
        <div
          key={call.id}
          data-testid="activity-toast"
          className="pointer-events-auto flex items-center gap-1.5 rounded-token border border-line bg-surface px-3 py-2 text-[12px] shadow-lg"
        >
          <span className={`h-1.5 w-1.5 flex-none rounded-full ${DOT_COLOR[call.status]}`} />
          <span className="font-mono text-ink">{describeToolCall(call)}</span>
        </div>
      ))}
    </div>
  );
}
