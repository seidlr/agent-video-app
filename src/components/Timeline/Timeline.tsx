import { useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { TimeSlider } from '@vidstack/react';
import { buildFilmstripTileStyles } from '../../media/thumbnails';
import { useStudio } from '../../store/studio';
import { ClipRanges } from './ClipRanges';
import { Filmstrip } from './Filmstrip';
import { ChapterLane, MarkLane } from './Markers';

/** Width of the lane-label column plus its gap -- the playhead overlay starts after it. */
const LABEL_COLUMN = 'grid-cols-[62px_minmax(0,1fr)]';
const CONTENT_OFFSET = 'left-[72px]';

function LaneLabel({ children }: { children: ReactNode }): ReactElement {
  return <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.06em] text-ink-4">{children}</div>;
}

function LegendItem({ swatch, children }: { swatch: string; children: ReactNode }): ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2 w-2 rounded-sm ${swatch}`} />
      {children}
    </span>
  );
}

/**
 * The editor timeline as labelled lanes (Claude Design screens/06-studio-v2.dc.html): the
 * filmstrip, titled chapter blocks, one lane of marks (notes, boxes, tracks, scene cuts), clip
 * ranges when there are any, and the scrub bar -- with a playhead spanning every lane. First ported
 * from ../agent-video-player/src/components/Timeline.tsx:20-184.
 */
export function Timeline(): ReactElement {
  const currentTime = useStudio((s) => s.player.currentTime);
  const duration = useStudio((s) => s.player.duration);
  const chapters = useStudio((s) => s.chapters);
  const notes = useStudio((s) => s.notes);
  const boxes = useStudio((s) => s.boxes);
  const tracks = useStudio((s) => s.tracks);
  const scenes = useStudio((s) => s.scenes);
  const clips = useStudio((s) => s.clips);
  const source = useStudio((s) => s.source);
  const seek = useStudio((s) => s.seek);
  const onSeek = (t: number): void => void seek(t);

  // The mediabunny-generated sprite (generate_thumbnails, Task 5) backs the Frames lane for a
  // local/URL source; YouTube uses its 4 ytimg stills (source.filmstripUrls) instead.
  const spriteTimestamps = source?.thumbnailsTimestamps;
  const filmstripTiles = useMemo(() => (spriteTimestamps ? buildFilmstripTileStyles(spriteTimestamps) : []), [spriteTimestamps]);
  const hasSprite = Boolean(source?.thumbnailsSpriteUrl) && filmstripTiles.length > 0;
  const hasFilmstrip = hasSprite || (source?.filmstripUrls?.length ?? 0) > 0;

  const navMarks = [...chapters.map((c) => c.start), ...notes.map((n) => n.time), ...boxes.map((b) => b.time)].sort((a, b) => a - b);

  function jumpToPrev(): void {
    if (!navMarks.length) return;
    const prev = [...navMarks].reverse().find((t) => t < currentTime - 0.1);
    onSeek(prev ?? (navMarks[navMarks.length - 1] as number));
  }

  function jumpToNext(): void {
    if (!navMarks.length) return;
    const next = navMarks.find((t) => t > currentTime + 0.1);
    onSeek(next ?? (navMarks[0] as number));
  }

  const playheadPct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div className="flex flex-col gap-2 rounded-token-lg border border-line bg-surface px-3.5 pb-2.5 pt-3">
      <div className={`relative grid ${LABEL_COLUMN} items-center gap-x-2.5 gap-y-1.5`}>
        {hasFilmstrip && (
          <>
            <LaneLabel>Frames</LaneLabel>
            {hasSprite && source?.thumbnailsSpriteUrl ? (
              <Filmstrip sprite={{ url: source.thumbnailsSpriteUrl, tiles: filmstripTiles }} />
            ) : (
              <Filmstrip urls={source?.filmstripUrls} />
            )}
          </>
        )}

        <LaneLabel>Chapters</LaneLabel>
        <ChapterLane chapters={chapters} duration={duration} currentTime={currentTime} onSeek={onSeek} />

        <LaneLabel>Marks</LaneLabel>
        <MarkLane notes={notes} boxes={boxes} tracks={tracks} scenes={scenes} chapters={chapters} duration={duration} onSeek={onSeek} />

        {clips.length > 0 && (
          <>
            <LaneLabel>Clips</LaneLabel>
            <ClipRanges clips={clips} duration={duration} onSeek={onSeek} />
          </>
        )}

        <LaneLabel>Time</LaneLabel>
        {/* Vidstack only publishes slider geometry as CSS variables (--slider-fill/--slider-progress)
            and never applies them -- without these w-[var(--...)] classes the fill renders 0px wide
            and seeks are invisible. The track stays one continuous bar even with chapters: the
            Chapters lane above shows the segmentation, and vidstack's own segmented
            TimeSlider.Chapters kept stale per-segment fills when chapters were added one at a time
            (confirmed live: 3 segments rendered for 2 chapters, and a later segment filling to the
            first one's percentage). TimeSlider.Root seeks the media element itself on drag/click;
            the store's currentTime follows via VideoStage's onTimeUpdate. */}
        <TimeSlider.Root className="group relative flex h-[18px] w-full cursor-pointer touch-none items-center outline-none select-none">
          <div className="relative h-1.5 w-full">
            <TimeSlider.Track data-testid="timeline-track" className="absolute inset-0 overflow-hidden rounded-full bg-line">
              <TimeSlider.TrackFill data-testid="timeline-fill" className="absolute inset-y-0 left-0 z-[1] w-[var(--slider-fill)] bg-clay" />
              <TimeSlider.Progress className="absolute inset-y-0 left-0 w-[var(--slider-progress)] bg-line-2" />
            </TimeSlider.Track>
            <TimeSlider.Thumb
              data-testid="timeline-thumb"
              className="absolute left-[var(--slider-fill)] top-1/2 z-20 -ml-[7px] -mt-[7px] h-3.5 w-3.5 rounded-full border-2 border-surface bg-clay opacity-0 shadow-[0_1px_4px_rgba(31,30,28,0.25)] transition-opacity group-hover:opacity-100 group-data-[active]:opacity-100"
            />
          </div>

          <TimeSlider.Preview className="pointer-events-none flex flex-col items-center gap-1 opacity-0 transition-opacity data-[visible]:opacity-100" offset={16}>
            {source?.thumbnailsVttUrl && (
              <TimeSlider.Thumbnail.Root
                src={source.thumbnailsVttUrl}
                className="block aspect-video w-[148px] overflow-hidden rounded-md border border-line bg-ink shadow-[0_4px_18px_rgba(31,30,28,0.18)]"
              >
                <TimeSlider.Thumbnail.Img />
              </TimeSlider.Thumbnail.Root>
            )}
            <TimeSlider.ChapterTitle className="max-w-[160px] truncate rounded border border-line bg-surface px-2 py-0.5 text-center text-[11px] font-medium tracking-[-0.005em] text-ink" />
            <TimeSlider.Value className="rounded bg-surface px-1 font-mono text-[10.5px] tabular-nums text-ink-3" type="pointer" format="time" />
          </TimeSlider.Preview>
        </TimeSlider.Root>

        {/* The playhead spans every lane so a mark, chapter or frame under it reads as "now". */}
        <div aria-hidden className={`pointer-events-none absolute inset-y-0 right-0 ${CONTENT_OFFSET}`}>
          <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-clay/80" style={{ left: `${playheadPct}%` }}>
            <span className="absolute -left-1 -top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-clay" />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 font-mono text-[10.5px] text-ink-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1">
          <LegendItem swatch="bg-clay">Chapters · {chapters.length}</LegendItem>
          {scenes.length > 0 && <LegendItem swatch="bg-clay/50">Scenes · {scenes.length}</LegendItem>}
          <LegendItem swatch="bg-ink-3">Notes · {notes.length}</LegendItem>
          <LegendItem swatch="bg-annotate">Boxes · {boxes.length}</LegendItem>
          {clips.length > 0 && <LegendItem swatch="border border-clay bg-clay-soft">Clips · {clips.length}</LegendItem>}
        </div>
        <div className="inline-flex flex-none items-center gap-1">
          <button
            type="button"
            aria-label="Previous mark"
            onClick={jumpToPrev}
            className="grid h-6 w-6 place-items-center rounded-md border border-line bg-surface text-ink-2 transition-colors hover:bg-surface-2"
          >
            <ChevronLeft size={12} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            aria-label="Next mark"
            onClick={jumpToNext}
            className="grid h-6 w-6 place-items-center rounded-md border border-line bg-surface text-ink-2 transition-colors hover:bg-surface-2"
          >
            <ChevronRight size={12} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}
