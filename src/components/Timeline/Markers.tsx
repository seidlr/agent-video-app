import type { ReactElement } from 'react';
import type { Box, Note } from '../../lib/types';

export interface MarkersProps {
  notes: Note[];
  boxes: Box[];
  duration: number;
}

/**
 * Point dots (notes without an end, and agent-drawn box timestamps) above the chapter track,
 * plus region bands (notes with an end) beneath it. Ported from
 * ../agent-video-player/src/components/Timeline.tsx:25-38,72-84,112-127, unified onto the new
 * Note/Box model (the old project split these across `annotations` and `allFrameBoxes`).
 */
export function Markers({ notes, boxes, duration }: MarkersProps): ReactElement {
  const effectiveDuration = duration > 0 ? duration : 1;
  const pointMarks = [
    ...notes.filter((n) => n.end === undefined).map((n) => n.time),
    ...boxes.map((b) => b.time),
  ].sort((a, b) => a - b);
  const regionBands = notes
    .filter((n): n is Note & { end: number } => n.end !== undefined)
    .map((n) => ({ start: n.time, end: n.end, label: n.text }))
    .sort((a, b) => a.start - b.start);

  return (
    <>
      <div className="relative mb-0.5 h-2 pointer-events-none">
        {pointMarks.map((t, i) => (
          <span
            key={i}
            className="absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-3"
            style={{ left: `${(t / effectiveDuration) * 100}%` }}
            title={`Marker at ${t.toFixed(2)}s`}
          />
        ))}
      </div>
      {regionBands.length > 0 && (
        <div className="relative mt-1 h-1.5 pointer-events-none">
          {regionBands.map((b, i) => (
            <span
              key={`${b.start}-${b.end}-${i}`}
              className="absolute top-0 h-1.5 rounded-full bg-ink-3/35"
              style={{
                left: `${(b.start / effectiveDuration) * 100}%`,
                width: `${Math.max(0.3, ((b.end - b.start) / effectiveDuration) * 100)}%`,
              }}
              title={`${b.label} (${b.start.toFixed(2)}s -> ${b.end.toFixed(2)}s)`}
            />
          ))}
        </div>
      )}
    </>
  );
}
