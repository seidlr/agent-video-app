import type { ReactElement } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { TimeSlider } from '@vidstack/react';
import { useStudio } from '../../store/studio';
import { ClipRanges } from './ClipRanges';
import { Markers } from './Markers';

/**
 * Ported from ../agent-video-player/src/components/Timeline.tsx:20-184, adapted to the new
 * store (chapters/notes/boxes replace chapters/annotations/allFrameBoxes) and to
 * source.thumbnailsVttUrl instead of a hardcoded THUMBNAILS_URL constant. FALLBACK_DURATION is
 * dropped -- an unloaded source renders a 0% track instead of guessing a length.
 */
export function Timeline(): ReactElement {
  const currentTime = useStudio((s) => s.player.currentTime);
  const duration = useStudio((s) => s.player.duration);
  const chapters = useStudio((s) => s.chapters);
  const notes = useStudio((s) => s.notes);
  const boxes = useStudio((s) => s.boxes);
  const scenes = useStudio((s) => s.scenes);
  const clips = useStudio((s) => s.clips);
  const source = useStudio((s) => s.source);
  const seek = useStudio((s) => s.seek);

  const navMarks = [
    ...chapters.map((c) => c.start),
    ...notes.map((n) => n.time),
    ...boxes.map((b) => b.time),
  ].sort((a, b) => a - b);

  function jumpToPrev(): void {
    if (!navMarks.length) return;
    const prev = [...navMarks].reverse().find((t) => t < currentTime - 0.1);
    void seek(prev ?? (navMarks[navMarks.length - 1] as number));
  }

  function jumpToNext(): void {
    if (!navMarks.length) return;
    const next = navMarks.find((t) => t > currentTime + 0.1);
    void seek(next ?? (navMarks[0] as number));
  }

  return (
    <div className="px-1.5 pt-1">
      {/* Vidstack only publishes slider geometry as CSS variables, it never applies them: the plain
          track reads --slider-fill/--slider-progress, and each chapter segment reads its own
          --chapter-fill/--chapter-progress while vidstack sizes the segment itself via an inline
          `width` (so no flex-1 here, which would override it with equal widths). Without these
          w-[var(--...)] classes every fill renders 0px wide and seeks are invisible. */}
      {/* TimeSlider.Root seeks the underlying media element itself on drag/click; the store's
          currentTime snapshot follows via VideoStage's onTimeUpdate, so no extra handler here. */}
      <TimeSlider.Root className="group relative flex w-full cursor-pointer touch-none flex-col pt-3 pb-1.5 outline-none select-none">
        <Markers chapters={chapters} notes={notes} boxes={boxes} scenes={scenes} duration={duration} onSeek={(t) => void seek(t)} />
        <ClipRanges clips={clips} duration={duration} onSeek={(t) => void seek(t)} />

        <div className="relative h-1">
          {chapters.length > 0 ? (
            <TimeSlider.Chapters className="absolute inset-0 flex items-center gap-[2px]">
              {(cues, forwardRef) =>
                cues.map((cue, i) => (
                  <TimeSlider.Track
                    key={`${cue.startTime}-${i}`}
                    ref={forwardRef}
                    data-testid="timeline-chapter-track"
                    className="relative h-1 overflow-hidden rounded-sm bg-line-2"
                  >
                    <TimeSlider.TrackFill data-testid="timeline-chapter-fill" className="absolute inset-y-0 left-0 w-[var(--chapter-fill)] bg-clay" />
                    <TimeSlider.Progress className="absolute inset-y-0 left-0 w-[var(--chapter-progress)] bg-line opacity-70" />
                  </TimeSlider.Track>
                ))
              }
            </TimeSlider.Chapters>
          ) : (
            <TimeSlider.Track data-testid="timeline-track" className="absolute inset-x-0 inset-y-0 overflow-hidden rounded-sm bg-line-2">
              <TimeSlider.TrackFill data-testid="timeline-fill" className="absolute inset-y-0 left-0 w-[var(--slider-fill)] bg-clay" />
              <TimeSlider.Progress className="absolute inset-y-0 left-0 w-[var(--slider-progress)] bg-line opacity-70" />
            </TimeSlider.Track>
          )}
        </div>

        <TimeSlider.Thumb
          data-testid="timeline-thumb"
          className="absolute left-[var(--slider-fill)] z-20 h-3 w-3 -ml-1.5 rounded-full border-2 border-surface bg-clay opacity-0 shadow-[0_1px_4px_rgba(31,30,28,0.18)] transition-opacity group-hover:opacity-100 group-data-[active]:opacity-100"
          style={{ top: '14px' }}
        />

        <TimeSlider.Preview
          className="pointer-events-none flex flex-col items-center gap-1 opacity-0 transition-opacity data-[visible]:opacity-100"
          offset={32}
        >
          {source?.thumbnailsVttUrl && (
            <TimeSlider.Thumbnail.Root
              src={source.thumbnailsVttUrl}
              className="block aspect-video w-[148px] overflow-hidden rounded-md border border-line bg-ink shadow-[0_4px_18px_rgba(31,30,28,0.18)]"
            >
              <TimeSlider.Thumbnail.Img />
            </TimeSlider.Thumbnail.Root>
          )}
          <TimeSlider.ChapterTitle className="max-w-[160px] truncate rounded border border-line bg-surface px-2 py-0.5 text-center text-[11px] font-medium tracking-[-0.005em] text-ink" />
          <TimeSlider.Value className="font-mono text-[10.5px] tabular-nums text-ink-3" type="pointer" format="time" />
        </TimeSlider.Preview>
      </TimeSlider.Root>

      <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-ink-3">
        <div className="inline-flex items-center gap-3.5">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm bg-clay" />
            Chapters · {chapters.length}
          </span>
          {scenes.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm bg-clay/50" />
              Scenes · {scenes.length}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm bg-ink-3" />
            Notes · {notes.length}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm bg-annotate" />
            Boxes · {boxes.length}
          </span>
          {clips.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm border border-clay bg-clay-soft" />
              Clips · {clips.length}
            </span>
          )}
        </div>
        <div className="inline-flex gap-1">
          <button
            type="button"
            aria-label="Previous mark"
            onClick={jumpToPrev}
            className="grid h-[22px] w-[22px] place-items-center rounded-md border border-line bg-surface text-ink-2 transition-colors hover:bg-surface-2"
          >
            <ChevronLeft size={10} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            aria-label="Next mark"
            onClick={jumpToNext}
            className="grid h-[22px] w-[22px] place-items-center rounded-md border border-line bg-surface text-ink-2 transition-colors hover:bg-surface-2"
          >
            <ChevronRight size={10} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}
