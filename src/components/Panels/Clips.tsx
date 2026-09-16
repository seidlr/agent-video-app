import { useState } from 'react';
import type { ReactElement } from 'react';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { parseTime, secsToTimecode } from '../../lib/time';
import { exportVideoClips } from '../../media/export';
import { getInput } from '../../media/input';
import { useStudio } from '../../store/studio';

/** Same Blob-download click as agent/tools/exports.ts's own triggerBlobDownload -- duplicated here
 * rather than shared, matching every other panel's own copy of this exact pattern (Notes.tsx,
 * Library.tsx's project export). */
function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Clips panel (Task 9, TS-007 step 1): add/list/reorder/delete clips. Same convention as
 * Notes.tsx -- UI actions call the store directly (addClip/removeClip/reorderClips) rather than
 * going through the agent registry, since the Activity feed is for what an *agent* did, not a
 * running log of human clicks; an agent instead uses `add_clip`/`remove_clip`/`reorder_clips`
 * (agent/tools/clips.ts), which call the exact same store actions.
 */
export function Clips(): ReactElement {
  const clips = useStudio((s) => s.clips);
  const boxes = useStudio((s) => s.boxes);
  const effects = useStudio((s) => s.effects);
  const voiceovers = useStudio((s) => s.voiceovers);
  const player = useStudio((s) => s.player);
  const source = useStudio((s) => s.source);
  const seek = useStudio((s) => s.seek);
  const addClip = useStudio((s) => s.addClip);
  const removeClip = useStudio((s) => s.removeClip);
  const reorderClips = useStudio((s) => s.reorderClips);

  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [format, setFormat] = useState<'mp4' | 'webm'>('mp4');
  const [width, setWidth] = useState('');
  const [burnOverlays, setBurnOverlays] = useState(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

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

  async function handleExportAll(): Promise<void> {
    if (!source || sorted.length === 0) return;
    setExportMessage(null);
    setExportProgress(0);
    try {
      const input = await getInput(source);
      const result = await exportVideoClips(input, {
        clips: sorted.map((c) => ({ start: c.start, end: c.end })),
        width: width.trim() ? Number(width) : undefined,
        format,
        burnOverlays,
        boxes,
        effects,
        voiceovers,
        onProgress: setExportProgress,
      });
      const actualFormat = result.forcedAlphaFormat ? 'webm' : format;
      triggerBlobDownload(result.blob, `agent-video-studio-export.${actualFormat}`);
      setExportMessage(
        `Exported ${sorted.length} clip(s), ${result.durationSeconds.toFixed(1)}s, ${result.width}x${result.height}${result.forcedAlphaFormat ? ' (forced to WebM/VP9 for a transparent-background effect)' : ''}.`,
      );
    } catch (err) {
      setExportMessage(err instanceof Error ? `Export failed: ${err.message}` : 'Export failed.');
    } finally {
      setExportProgress(null);
    }
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

      {sorted.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-3">
          <h3 className="text-[13px] font-semibold">Export all</h3>
          <div className="flex gap-1.5">
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as 'mp4' | 'webm')}
              className="rounded border border-line bg-surface px-1.5 py-1 text-[11px]"
              aria-label="Export format"
            >
              <option value="mp4">MP4</option>
              <option value="webm">WebM</option>
            </select>
            <input
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              placeholder="width (px)"
              className="w-24 rounded border border-line bg-surface px-1.5 py-1 font-mono text-[11px]"
              aria-label="Export width"
            />
          </div>
          <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
            <input type="checkbox" checked={burnOverlays} onChange={(e) => setBurnOverlays(e.target.checked)} />
            Burn box overlays into the video
          </label>
          <button
            type="button"
            onClick={() => void handleExportAll()}
            disabled={exportProgress !== null}
            className="self-start rounded-token bg-ink px-2.5 py-1 text-[12px] font-medium text-surface disabled:opacity-50"
          >
            {exportProgress !== null ? `Exporting... ${Math.round(exportProgress * 100)}%` : 'Export all'}
          </button>
          {exportMessage && <p className="text-[11px] text-ink-3">{exportMessage}</p>}
        </div>
      )}
    </div>
  );
}
