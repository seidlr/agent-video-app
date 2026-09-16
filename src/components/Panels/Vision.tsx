import { useState } from 'react';
import type { ReactElement } from 'react';
import { secsToTimecode } from '../../lib/time';
import { useStudio, type VisionResult } from '../../store/studio';

const KIND_LABELS: Record<VisionResult['kind'], string> = {
  describe: 'Frame description',
  describe_range: 'Range description',
  ask: 'Answer',
  dense_captions: 'Dense captions',
};

/** How long a chapter should span when promoting a vision result (a single point in time, not a
 * range) to one -- long enough to read as a real chapter, short enough to rarely collide with
 * whatever the agent adds right after it. */
const CHAPTER_SPAN_SECONDS = 5;
const CHAPTER_TITLE_MAX = 60;

/**
 * Vision panel: the Task 12 VLM/Florence-2 text-result history (describe_frame/describe_range/
 * ask_about_frame), streamed live while a call is in flight, each promotable to a note or chapter
 * title -- plus (below it, unchanged from Task 8) the search_frames hit list with click-to-seek.
 * Promotion buttons call the store directly, same pattern Notes.tsx already uses for its own
 * Add note/Add chapter actions, rather than round-tripping through the agent registry for a
 * plain human click.
 */
export function Vision(): ReactElement {
  const vision = useStudio((s) => s.vision);
  const visionStreaming = useStudio((s) => s.visionStreaming);
  const visionSearch = useStudio((s) => s.visionSearch);
  const duration = useStudio((s) => s.player.duration);
  const seek = useStudio((s) => s.seek);
  const addNote = useStudio((s) => s.addNote);
  const addChapter = useStudio((s) => s.addChapter);

  const [noteFeedback, setNoteFeedback] = useState<string | null>(null);
  const [chapterFeedback, setChapterFeedback] = useState<{ id: string; error: boolean } | null>(null);

  function handleAddNote(r: VisionResult): void {
    addNote({ time: r.time, text: r.text, tags: [r.kind], createdBy: 'agent' });
    setNoteFeedback(r.id);
    setTimeout(() => setNoteFeedback((id) => (id === r.id ? null : id)), 1500);
  }

  function handleAddChapter(r: VisionResult): void {
    const end = Math.min(r.time + CHAPTER_SPAN_SECONDS, duration || r.time + CHAPTER_SPAN_SECONDS);
    const title = r.text.length > CHAPTER_TITLE_MAX ? `${r.text.slice(0, CHAPTER_TITLE_MAX - 1)}…` : r.text;
    try {
      addChapter({ start: r.time, end: end > r.time ? end : r.time + 0.1, title });
      setChapterFeedback({ id: r.id, error: false });
    } catch {
      setChapterFeedback({ id: r.id, error: true });
    }
    setTimeout(() => setChapterFeedback((f) => (f?.id === r.id ? null : f)), 1500);
  }

  const hasVisionResults = vision.length > 0 || visionStreaming !== null;

  return (
    <div className="flex flex-col gap-3.5">
      {hasVisionResults && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-semibold">Vision results</h3>

          {visionStreaming !== null && (
            <div aria-live="polite" className="rounded-token border border-line bg-surface-2 p-2 text-[12.5px]">
              <span className="font-mono text-[11px] text-ink-3">Describing…</span>
              <p className="mt-0.5 whitespace-pre-wrap">{visionStreaming}</p>
            </div>
          )}

          {[...vision].reverse().map((r) => (
            <div key={r.id} className="flex flex-col gap-1.5 rounded-token bg-surface-2 p-2 text-[12.5px]">
              <button type="button" onClick={() => void seek(r.time)} className="min-w-0 text-left" aria-label={`Seek to vision result at ${secsToTimecode(r.time)}`}>
                <span className="font-mono text-[11px] text-ink-3">
                  {secsToTimecode(r.time)} · {KIND_LABELS[r.kind]} · {r.model}
                </span>
                <p className="mt-0.5 whitespace-pre-wrap">{r.text}</p>
              </button>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => handleAddNote(r)} className="rounded px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-line">
                  {noteFeedback === r.id ? 'Added!' : 'Add as note'}
                </button>
                <button type="button" onClick={() => handleAddChapter(r)} className="rounded px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-line">
                  {chapterFeedback?.id === r.id ? (chapterFeedback.error ? 'Overlaps existing chapter' : 'Added!') : 'Add as chapter title'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <div>
          <h3 className="text-[13px] font-semibold">Search results</h3>
          {visionSearch && <p className="font-mono text-[11px] text-ink-3">"{visionSearch.query}"</p>}
        </div>

        {!visionSearch ? (
          <p className="text-[13px] text-ink-3">
            No search yet -- ask the agent to run `search_frames` (e.g. "find the moment it turns red") to see ranked matches here.
          </p>
        ) : visionSearch.ranges.length === 0 ? (
          <p className="text-[13px] text-ink-3">No matching ranges.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {visionSearch.ranges.map((r, i) => (
              <button
                key={`${r.start}-${i}`}
                type="button"
                onClick={() => void seek(r.start)}
                className="flex items-center justify-between gap-2 rounded-token bg-surface-2 p-2 text-left text-[12.5px]"
              >
                <span className="font-mono text-[11px] text-ink-3">
                  {secsToTimecode(r.start)} → {secsToTimecode(r.end)}
                </span>
                <span className="rounded bg-chip px-1.5 py-0.5 text-[11px] text-ink-2">{Math.round(r.score * 100)}%</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
