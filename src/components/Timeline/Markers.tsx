import type { ReactElement } from 'react';
import type { Box, Chapter, Note } from '../../lib/types';
import type { Scene } from '../../media/scenes';

export interface MarkersProps {
  chapters: Chapter[];
  notes: Note[];
  boxes: Box[];
  /** `detect_scenes`'s own most recent result (Task 8), independent of `chapters` -- rendered as
   * a thin boundary tick even when the caller didn't pass `addChapters:true`. */
  scenes: Scene[];
  duration: number;
  onSeek: (time: number) => void;
}

/**
 * Chapter ticks, note points/regions, and box ticks along the timeline, each clickable to seek
 * (TS-004 step 1/2: "Two markers on the timeline (point + region)", "Chapter tick on timeline").
 * Ported from ../agent-video-player/src/components/Timeline.tsx:25-38,72-84,112-127, unified onto
 * the new Note/Box/Chapter model (the old project split these across `annotations` and
 * `allFrameBoxes` and had no chapter ticks or click-to-seek at all -- both are new for Task 6).
 * Notes and boxes get visually distinct dots (`--color-ink-3` vs the reserved `--color-annotate`,
 * which every other agent-drawn overlay in this app already uses) so the two are tellable apart
 * at a glance. Each marker row is `z-30`, above Timeline.tsx's `TimeSlider.Thumb` (`z-20`) -- both
 * are absolutely-positioned siblings inside the same `TimeSlider.Root`, so a marker landing near
 * the current playhead position (e.g. a note near t=0, matching a freshly-loaded video's Thumb)
 * would otherwise sit *under* the Thumb and silently eat every click meant for the marker
 * (confirmed empirically: a real click on a visible, enabled marker button never registered).
 */
export function Markers({ chapters, notes, boxes, scenes, duration, onSeek }: MarkersProps): ReactElement {
  const effectiveDuration = duration > 0 ? duration : 1;
  const pct = (t: number): string => `${(t / effectiveDuration) * 100}%`;

  const pointNotes = notes.filter((n) => n.end === undefined).sort((a, b) => a.time - b.time);
  const regionBands = notes
    .filter((n): n is Note & { end: number } => n.end !== undefined)
    .map((n) => ({ start: n.time, end: n.end, label: n.text }))
    .sort((a, b) => a.start - b.start);
  const sortedBoxes = [...boxes].sort((a, b) => a.time - b.time);
  const sortedChapters = [...chapters].sort((a, b) => a.start - b.start);
  // A "boundary" is a transition between two detected scenes, i.e. every scene's start except the
  // first (which is just the start of the video, not a cut) -- deduplicated against committed
  // chapter starts so a `detect_scenes {addChapters:true}` result doesn't draw two overlapping
  // ticks for the same instant.
  const chapterStarts = new Set(sortedChapters.map((c) => c.start));
  const sceneBoundaries = [...scenes]
    .sort((a, b) => a.start - b.start)
    .slice(1)
    .map((s) => s.start)
    .filter((t) => !chapterStarts.has(t));

  return (
    <>
      {sortedChapters.length > 0 && (
        <div className="relative z-30 mb-0.5 h-1.5 pointer-events-none">
          {sortedChapters.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onSeek(c.start)}
              className="absolute top-0 h-1.5 w-0.5 -translate-x-1/2 rounded-full bg-clay pointer-events-auto"
              style={{ left: pct(c.start) }}
              title={`Chapter "${c.title}" at ${c.start.toFixed(2)}s`}
              aria-label={`Seek to chapter ${c.title}`}
            />
          ))}
        </div>
      )}
      {sceneBoundaries.length > 0 && (
        <div className="relative z-30 mb-0.5 h-1.5 pointer-events-none" data-testid="scene-boundaries">
          {sceneBoundaries.map((t) => (
            <button
              key={`scene-${t}`}
              type="button"
              onClick={() => onSeek(t)}
              className="absolute top-0 h-1.5 w-px -translate-x-1/2 bg-clay/50 pointer-events-auto"
              style={{ left: pct(t) }}
              title={`Detected scene boundary at ${t.toFixed(2)}s`}
              aria-label={`Seek to detected scene boundary at ${t.toFixed(2)}s`}
            />
          ))}
        </div>
      )}
      <div className="relative z-30 mb-0.5 h-2 pointer-events-none">
        {pointNotes.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => onSeek(n.time)}
            className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-3 pointer-events-auto"
            style={{ left: pct(n.time) }}
            title={`Note: ${n.text} (${n.time.toFixed(2)}s)`}
            aria-label={`Seek to note: ${n.text}`}
          />
        ))}
        {sortedBoxes.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onSeek(b.time)}
            className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-annotate pointer-events-auto"
            style={{ left: pct(b.time) }}
            title={`Box: ${b.label} (${b.time.toFixed(2)}s)`}
            aria-label={`Seek to box: ${b.label}`}
          />
        ))}
      </div>
      {regionBands.length > 0 && (
        <div className="relative z-30 mt-1 h-1.5 pointer-events-none">
          {regionBands.map((b, i) => (
            <button
              key={`${b.start}-${b.end}-${i}`}
              type="button"
              onClick={() => onSeek(b.start)}
              className="absolute top-0 h-1.5 rounded-full bg-ink-3/35 pointer-events-auto"
              style={{ left: pct(b.start), width: `${Math.max(0.3, ((b.end - b.start) / effectiveDuration) * 100)}%` }}
              title={`${b.label} (${b.start.toFixed(2)}s -> ${b.end.toFixed(2)}s)`}
              aria-label={`Seek to note region: ${b.label}`}
            />
          ))}
        </div>
      )}
    </>
  );
}
