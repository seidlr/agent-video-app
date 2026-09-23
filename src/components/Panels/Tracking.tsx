import { useState } from 'react';
import type { ReactElement } from 'react';
import { Trash2 } from 'lucide-react';
import { runTrack } from '../../agent/tools/vision';
import { secsToTimecode } from '../../lib/time';
import { deletePersistedBox, deletePersistedTrack } from '../../store/boxes';
import { studioStore, useStudio } from '../../store/studio';

/**
 * Lists every box (agent-drawn or manual) and its track, if any, with label editing and delete --
 * the human-facing counterpart to Task 7's segment/track/boxes CRUD tools. "Draw box" arms
 * Stage/BoxDrawLayer.tsx for a drag-to-draw manual box; "Segment" arms Stage/SegmentClickLayer.tsx
 * for a click-to-segment point prompt, and each box's own "Track 3s" button calls
 * agent/tools/vision.ts's runTrack directly -- the exact same pipeline the `segment`/`track` tools
 * use, not a reimplementation (this closes this file's own former SHORTCUT: see runSegment/
 * runTrack's doc comments in vision.ts for how they became shared, reusable functions).
 */
export function Tracking(): ReactElement {
  const boxes = useStudio((s) => s.boxes);
  const tracks = useStudio((s) => s.tracks);
  const boxDrawMode = useStudio((s) => s.boxDrawMode);
  const setBoxDrawMode = useStudio((s) => s.setBoxDrawMode);
  const segmentClickMode = useStudio((s) => s.segmentClickMode);
  const setSegmentClickMode = useStudio((s) => s.setSegmentClickMode);
  const seek = useStudio((s) => s.seek);
  const updateBox = useStudio((s) => s.updateBox);
  const removeBox = useStudio((s) => s.removeBox);
  const removeTrack = useStudio((s) => s.removeTrack);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState('');
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [trackFeedback, setTrackFeedback] = useState<{ id: string; text: string } | null>(null);

  async function handleDeleteBox(id: string): Promise<void> {
    const box = boxes.find((b) => b.id === id);
    removeBox(id);
    await deletePersistedBox(id);
    if (box?.trackId) {
      removeTrack(box.trackId);
      await deletePersistedTrack(box.trackId);
    }
  }

  function commitLabel(id: string): void {
    if (labelDraft.trim()) updateBox(id, { label: labelDraft.trim() });
    setEditingId(null);
  }

  async function handleTrack(boxId: string, boxTime: number): Promise<void> {
    setTrackingId(boxId);
    setTrackFeedback(null);
    try {
      const result = await runTrack(studioStore, { boxId, until: boxTime + 3, stepSeconds: 0.25 });
      setTrackFeedback({ id: boxId, text: result.ok ? result.summary : result.error });
    } finally {
      setTrackingId(null);
      setTimeout(() => setTrackFeedback((f) => (f?.id === boxId ? null : f)), 3000);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => {
            setBoxDrawMode(!boxDrawMode);
            if (!boxDrawMode) setSegmentClickMode(false);
          }}
          className={`self-start rounded-token px-2.5 py-1 text-[12px] font-medium ${boxDrawMode ? 'bg-annotate text-annotate-ink' : 'bg-ink text-surface'}`}
        >
          {boxDrawMode ? 'Drawing… (drag on the paused video)' : 'Draw box'}
        </button>
        <button
          type="button"
          onClick={() => {
            setSegmentClickMode(!segmentClickMode);
            if (!segmentClickMode) setBoxDrawMode(false);
          }}
          className={`self-start rounded-token px-2.5 py-1 text-[12px] font-medium ${segmentClickMode ? 'bg-annotate text-annotate-ink' : 'bg-ink text-surface'}`}
        >
          {segmentClickMode ? 'Segmenting… (click on the paused video)' : 'Segment'}
        </button>
      </div>

      {boxes.length === 0 ? (
        <p className="text-[13px] text-ink-3">No boxes yet. Ask an agent to call segment, or draw one above.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {boxes.map((box) => {
            const track = box.trackId ? tracks.find((t) => t.id === box.trackId) : undefined;
            const trackStart = track?.keyframes[0]?.time;
            const trackEnd = track?.keyframes[track.keyframes.length - 1]?.time;

            return (
              <div key={box.id} className="rounded-token bg-surface-2 p-2 text-[12.5px]">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => void seek(box.time)} className="flex-none font-mono text-[11px] text-ink-3">
                    {secsToTimecode(box.time)}
                  </button>
                  {editingId === box.id ? (
                    <input
                      autoFocus
                      value={labelDraft}
                      onChange={(e) => setLabelDraft(e.target.value)}
                      onBlur={() => commitLabel(box.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitLabel(box.id);
                      }}
                      aria-label={`Edit label for box at ${secsToTimecode(box.time)}`}
                      className="min-w-0 flex-1 rounded border border-line bg-surface px-1 py-0.5"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(box.id);
                        setLabelDraft(box.label);
                      }}
                      className="min-w-0 flex-1 truncate text-left font-medium"
                    >
                      {box.label}
                    </button>
                  )}
                  <span className="flex-none rounded bg-chip px-1.5 py-0.5 text-[10px] text-ink-2">{box.source}</span>
                  {!track && (
                    <button
                      type="button"
                      disabled={trackingId === box.id}
                      onClick={() => void handleTrack(box.id, box.time)}
                      className="flex-none rounded px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-line disabled:opacity-50"
                    >
                      {trackingId === box.id ? 'Tracking…' : 'Track 3s'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleDeleteBox(box.id)}
                    aria-label={`Delete box: ${box.label}`}
                    className="grid h-5 w-5 flex-none place-items-center rounded text-ink-3 hover:bg-line hover:text-clay-ink"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
                {trackFeedback?.id === box.id && <p className="mt-1 text-[11px] text-ink-3">{trackFeedback.text}</p>}
                {track && trackStart !== undefined && trackEnd !== undefined && (
                  <p className="mt-1 text-[11px] text-ink-3">
                    Track: {track.keyframes.length} keyframe(s), {secsToTimecode(trackStart)} → {secsToTimecode(trackEnd)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
