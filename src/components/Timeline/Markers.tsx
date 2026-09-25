import type { ReactElement } from 'react';
import type { Box, Chapter, Note, Track } from '../../lib/types';
import type { Scene } from '../../media/scenes';

function toPct(duration: number): (t: number) => string {
  const effective = duration > 0 ? duration : 1;
  return (t: number) => `${(t / effective) * 100}%`;
}

function span(start: number, end: number, duration: number): string {
  const effective = duration > 0 ? duration : 1;
  return `${Math.max(0.3, ((end - start) / effective) * 100)}%`;
}

export interface ChapterLaneProps {
  chapters: Chapter[];
  duration: number;
  currentTime: number;
  onSeek: (time: number) => void;
}

/**
 * Chapters as labelled blocks sized by their own start/end (Claude Design
 * screens/06-studio-v2.dc.html), replacing the bare ticks of the first design: a human reads where
 * they are by title, not by counting marks. The block under the playhead is highlighted.
 */
export function ChapterLane({ chapters, duration, currentTime, onSeek }: ChapterLaneProps): ReactElement {
  const pct = toPct(duration);
  const sorted = [...chapters].sort((a, b) => a.start - b.start);

  if (sorted.length === 0) {
    return <div className="flex h-[22px] items-center text-[11px] text-ink-4">No chapters yet</div>;
  }

  return (
    <div className="relative h-[22px]">
      {sorted.map((c) => {
        const active = currentTime >= c.start && currentTime < c.end;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onSeek(c.start)}
            className={`absolute inset-y-0 flex items-center overflow-hidden whitespace-nowrap rounded-md border px-2 text-left text-[11.5px] transition-colors ${
              active ? 'z-[1] border-transparent bg-clay-soft font-semibold text-clay-ink' : 'border-line bg-surface-2 font-medium text-ink-2 hover:border-line-2 hover:text-ink'
            }`}
            style={{ left: pct(c.start), width: `calc(${span(c.start, c.end, duration)} - 2px)` }}
            title={`Chapter "${c.title}" at ${c.start.toFixed(2)}s`}
            aria-label={`Seek to chapter ${c.title}`}
          >
            <span className="truncate">{c.title}</span>
          </button>
        );
      })}
    </div>
  );
}

export interface MarkLaneProps {
  notes: Note[];
  boxes: Box[];
  tracks: Track[];
  /** `detect_scenes`'s own most recent result (Task 8), independent of `chapters` -- drawn as a
   * thin boundary tick even when the caller didn't pass `addChapters:true`. */
  scenes: Scene[];
  chapters: Chapter[];
  duration: number;
  onSeek: (time: number) => void;
}

/**
 * Every point-in-time mark on one lane: note pins and note-region bands (`--color-ink-3`), box pins
 * and track spans in the reserved agent-annotation color (`--color-annotate`, never a UI color), and
 * detected scene boundaries. Each pin is a 18px hit target around a 9px dot.
 */
export function MarkLane({ notes, boxes, tracks, scenes, chapters, duration, onSeek }: MarkLaneProps): ReactElement {
  const pct = toPct(duration);
  const pointNotes = notes.filter((n) => n.end === undefined).sort((a, b) => a.time - b.time);
  const regionBands = notes
    .filter((n): n is Note & { end: number } => n.end !== undefined)
    .map((n) => ({ start: n.time, end: n.end, label: n.text }))
    .sort((a, b) => a.start - b.start);
  const sortedBoxes = [...boxes].sort((a, b) => a.time - b.time);
  const trackSpans = tracks
    .map((t) => ({ id: t.id, start: t.keyframes[0]?.time, end: t.keyframes[t.keyframes.length - 1]?.time }))
    .filter((t): t is { id: string; start: number; end: number } => t.start !== undefined && t.end !== undefined && t.end > t.start);
  // A boundary is a transition between two detected scenes -- every scene's start except the first
  // (the start of the video, not a cut) -- deduplicated against chapter starts so a
  // `detect_scenes {addChapters:true}` result doesn't draw a tick on top of a chapter edge.
  const chapterStarts = new Set(chapters.map((c) => c.start));
  const sceneBoundaries = [...scenes]
    .sort((a, b) => a.start - b.start)
    .slice(1)
    .map((s) => s.start)
    .filter((t) => !chapterStarts.has(t));

  return (
    <div className="relative h-[18px]">
      {regionBands.map((b, i) => (
        <button
          key={`${b.start}-${b.end}-${i}`}
          type="button"
          onClick={() => onSeek(b.start)}
          className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-ink-3/30 hover:bg-ink-3/50"
          style={{ left: pct(b.start), width: span(b.start, b.end, duration) }}
          title={`${b.label} (${b.start.toFixed(2)}s -> ${b.end.toFixed(2)}s)`}
          aria-label={`Seek to note region: ${b.label}`}
        />
      ))}
      {trackSpans.map((t) => (
        <div
          key={t.id}
          className="pointer-events-none absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-annotate/70"
          style={{ left: pct(t.start), width: span(t.start, t.end, duration) }}
          title={`Track ${t.start.toFixed(2)}s -> ${t.end.toFixed(2)}s`}
        />
      ))}
      {sceneBoundaries.length > 0 && (
        <div className="pointer-events-none absolute inset-0" data-testid="scene-boundaries">
          {sceneBoundaries.map((t) => (
            <button
              key={`scene-${t}`}
              type="button"
              onClick={() => onSeek(t)}
              className="pointer-events-auto absolute inset-y-0 w-[3px] -translate-x-1/2 rounded-full bg-clay/45 hover:bg-clay"
              style={{ left: pct(t) }}
              title={`Detected scene boundary at ${t.toFixed(2)}s`}
              aria-label={`Seek to detected scene boundary at ${t.toFixed(2)}s`}
            />
          ))}
        </div>
      )}
      {pointNotes.map((n) => (
        <button
          key={n.id}
          type="button"
          onClick={() => onSeek(n.time)}
          className="group absolute top-1/2 grid h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 place-items-center"
          style={{ left: pct(n.time) }}
          title={`Note: ${n.text} (${n.time.toFixed(2)}s)`}
          aria-label={`Seek to note: ${n.text}`}
        >
          <span className="h-[9px] w-[9px] rounded-full border-2 border-surface bg-ink-3 group-hover:scale-125" />
        </button>
      ))}
      {sortedBoxes.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => onSeek(b.time)}
          className="group absolute top-1/2 grid h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 place-items-center"
          style={{ left: pct(b.time) }}
          title={`Box: ${b.label} (${b.time.toFixed(2)}s)`}
          aria-label={`Seek to box: ${b.label}`}
        >
          <span className="h-[9px] w-[9px] rounded-full border-2 border-surface bg-annotate group-hover:scale-125" />
        </button>
      ))}
    </div>
  );
}
