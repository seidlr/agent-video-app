import { useState } from 'react';
import type { ReactElement } from 'react';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { parseTime, secsToTimecode } from '../../lib/time';
import { useStudio } from '../../store/studio';

/**
 * Clips panel (Task 9, TS-007 step 1): add/list/reorder/delete clips. Same convention as
 * Notes.tsx -- UI actions call the store directly (addClip/removeClip/reorderClips) rather than
 * going through the agent registry, since the Activity feed is for what an *agent* did, not a
 * running log of human clicks; an agent instead uses `add_clip`/`remove_clip`/`reorder_clips`
 * (agent/tools/clips.ts), which call the exact same store actions.
 */
export function Clips(): ReactElement {
  const clips = useStudio((s) => s.clips);
  const player = useStudio((s) => s.player);
  const seek = useStudio((s) => s.seek);
  const addClip = useStudio((s) => s.addClip);
  const removeClip = useStudio((s) => s.removeClip);
  const reorderClips = useStudio((s) => s.reorderClips);

  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const timeCtx = { currentTime: player.currentTime, duration: player.duration, fps: player.fps };
  const sorted = [...clips].sort((a, b) => a.order - b.order);

  function handleAdd(): void {
    setError(null);
    const parsedStart = parseTime(start || 0, timeCtx);
    const parsedEnd = parseTime(end, timeCtx);
    if (parsedStart === null || parsedEnd === null) return setError('Invalid start/end.');
    if (parsedEnd <= parsedStart) return setError('End must be after start.');
    addClip({ start: parsedStart, end: parsedEnd, name: name.trim() || undefined, order: clips.length });
    setStart('');
    setEnd('');
    setName('');
  }

  function moveClip(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;
    const order = sorted.map((c) => c.id);
    const tmp = order[index]!;
    order[index] = order[target]!;
    order[target] = tmp;
    reorderClips(order);
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5 rounded-token border border-line bg-surface-2 p-2">
        <div className="flex gap-1.5">
          <input
            value={start}
            onChange={(e) => setStart(e.target.value)}
            placeholder="start"
            className="w-16 rounded border border-line bg-surface px-1.5 py-1 font-mono text-[11px]"
            aria-label="Clip start"
          />
          <input
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            placeholder="end"
            className="w-16 rounded border border-line bg-surface px-1.5 py-1 font-mono text-[11px]"
            aria-label="Clip end"
          />
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional)"
          className="rounded border border-line bg-surface px-1.5 py-1 text-[12.5px]"
          aria-label="Clip name"
        />
        {error && <p className="text-[11px] text-clay-ink">{error}</p>}
        <button type="button" onClick={handleAdd} className="self-start rounded-token bg-ink px-2.5 py-1 text-[12px] font-medium text-surface">
          Add clip
        </button>
      </div>

      {sorted.length === 0 ? (
        <p className="text-[13px] text-ink-3">No clips yet.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {sorted.map((c, i) => (
            <div key={c.id} className="flex items-center gap-2 rounded-token bg-surface-2 p-2 text-[12.5px]">
              <button type="button" onClick={() => void seek(c.start)} className="min-w-0 flex-1 text-left">
                <span className="font-mono text-[11px] text-ink-3">
                  {secsToTimecode(c.start)} → {secsToTimecode(c.end)} ({(c.end - c.start).toFixed(1)}s)
                </span>
                <p className="truncate font-medium">{c.name || `Clip ${i + 1}`}</p>
              </button>
              <div className="flex flex-none flex-col">
                <button type="button" onClick={() => moveClip(i, -1)} disabled={i === 0} aria-label={`Move clip ${i + 1} up`} className="grid h-4 w-5 place-items-center rounded text-ink-3 hover:bg-line disabled:opacity-30">
                  <ChevronUp size={10} />
                </button>
                <button type="button" onClick={() => moveClip(i, 1)} disabled={i === sorted.length - 1} aria-label={`Move clip ${i + 1} down`} className="grid h-4 w-5 place-items-center rounded text-ink-3 hover:bg-line disabled:opacity-30">
                  <ChevronDown size={10} />
                </button>
              </div>
              <button
                type="button"
                onClick={() => removeClip(c.id)}
                aria-label={`Delete clip ${i + 1}`}
                className="grid h-5 w-5 flex-none place-items-center rounded text-ink-3 hover:bg-line hover:text-clay-ink"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
