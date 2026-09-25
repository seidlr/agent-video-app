import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { MediaPlayer, MediaProvider, Track, type MediaPlayerInstance, type VideoMimeType } from '@vidstack/react';
import { BoxDrawLayer } from './BoxDrawLayer';
import { BoxOverlay } from './BoxOverlay';
import { SegmentClickLayer } from './SegmentClickLayer';
import { MaskOverlay } from './MaskOverlay';
import { PoseOverlay } from './PoseOverlay';
import { Chrome } from './Chrome';
import { FrameLabel } from './FrameLabel';
import { FrameTitle } from './FrameTitle';
import { PlayOverlay } from './PlayOverlay';
import { Filmstrip } from '../Timeline/Filmstrip';
import { Timeline } from '../Timeline/Timeline';
import { chaptersToVttDataUrl } from '../../lib/chapters';
import { buildFilmstripTileStyles } from '../../media/thumbnails';
import { updateAssetMetadata } from '../../store/library';
import { useStudio } from '../../store/studio';

/**
 * Ported from ../agent-video-player/src/components/VideoStage/VideoStage.tsx:166-206 and
 * Chrome.tsx, adapted to the new store and stripped of Firebase session sync (Task 2's
 * Out of Scope; this app is front-end only). Duration/dimensions are captured via
 * playerRef.current.subscribe() (see the effect below for why) instead of the loadedmetadata/
 * durationchange DOM events.
 */
export function VideoStage(): ReactElement {
  const playerRef = useRef<MediaPlayerInstance>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hasPlayed, setHasPlayed] = useState(false);

  const source = useStudio((s) => s.source);
  const paused = useStudio((s) => s.player.paused);
  const chapters = useStudio((s) => s.chapters);
  const currentTime = useStudio((s) => s.player.currentTime);
  const registerPlayer = useStudio((s) => s.registerPlayer);
  const setCurrentTime = useStudio((s) => s.setCurrentTime);
  const setDuration = useStudio((s) => s.setDuration);
  const setDimensions = useStudio((s) => s.setDimensions);
  const setPaused = useStudio((s) => s.setPaused);
  const setPlayerVolume = useStudio((s) => s.setPlayerVolume);
  const setPlayerRate = useStudio((s) => s.setPlayerRate);
  const setPlayerMuted = useStudio((s) => s.setPlayerMuted);
  const stepFrames = useStudio((s) => s.stepFrames);
  const loop = useStudio((s) => s.player.loop);
  const seek = useStudio((s) => s.seek);

  const activeChapter = chapters.find((c) => currentTime >= c.start && currentTime <= c.end) ?? null;
  const activeIndex = activeChapter ? Math.max(0, chapters.indexOf(activeChapter)) : 0;

  // Timeline.tsx's TimeSlider.Chapters (the segmented progress bar) reads vidstack's own
  // "chapters" text track, not React state directly -- this is the one place the object-model
  // chapters get serialized back to a VTT resource for that <Track> to load. Keyed on the URL
  // itself (which changes whenever chapters change) so vidstack reloads the track on every edit,
  // same as the reference project's own `key={vttUrl}` (../agent-video-player/src/components/
  // VideoStage/VideoStage.tsx:194).
  const chaptersVttUrl = useMemo(() => chaptersToVttDataUrl(chapters), [chapters]);

  // The mediabunny-generated sprite (generate_thumbnails, Task 5) backs the real Filmstrip strip
  // for a local/URL source; YouTube keeps its separate source.filmstripUrls (4 ytimg stills) --
  // the two are mutually exclusive per source.
  const spriteUrl = source?.thumbnailsSpriteUrl;
  const spriteTimestamps = source?.thumbnailsTimestamps;
  const filmstripTiles = useMemo(
    () => (spriteTimestamps ? buildFilmstripTileStyles(spriteTimestamps) : []),
    [spriteTimestamps],
  );

  useEffect(() => {
    registerPlayer(playerRef.current);
    return () => registerPlayer(null);
  }, [registerPlayer, source]);

  /**
   * `loadedmetadata`/`durationchange` are one-shot DOM events that can fire before React's
   * vidstack-react event bridge finishes attaching its listeners (confirmed empirically: with
   * only onLoadedMetadata/onDurationChange wired, duration/width/height stayed 0 even though the
   * underlying <video> reached readyState 4 with the correct duration) -- and if the video is
   * never played, no later event ever gives metadata capture a second chance either (confirmed
   * via tests/e2e/tools-playback.spec.ts: an agent calling load_video then get_state without
   * ever playing saw duration stuck at 0). `player.subscribe()` is vidstack's own reactive
   * primitive (Maverick.js signals): the callback runs once immediately with whatever the
   * *current* state already is, then again on every future change, so there is no "did the event
   * fire before or after we started listening" window to lose at all.
   */
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    let applied = false;
    return player.subscribe((state) => {
      if (applied || !state.duration) return;
      applied = true;
      setDuration(state.duration);
      setDimensions(state.width || 0, state.height || 0);
      if (source?.kind === 'file' && source.assetId) {
        void updateAssetMetadata(source.assetId, { duration: state.duration, width: state.width || 0, height: state.height || 0 });
      }
    });
  }, [source, setDuration, setDimensions]);

  function handleLoadedMetadata(): void {
    // Prime the player to clear the poster on browsers that allow a brief silent play.
    playerRef.current
      ?.play()
      .then(() => {
        setTimeout(() => playerRef.current?.pause(), 150);
      })
      .catch(() => {
        // Autoplay policy blocked the silent priming play; the first user click reveals the frame.
      });
  }

  /**
   * Split into per-field syncs rather than one handler that re-reads volume/muted/rate on every
   * event, no matter which one fired. That blanket version had a real race, caught by
   * tests/e2e/tools-playback.spec.ts's set_playback step (volume, muted and rate applied back to
   * back): setting volume dispatches a native `volumechange` asynchronously, and by the time it
   * arrives here a few ms later, a *subsequent* setPlayerRate call may already have applied a new
   * rate -- but this handler would still re-read state.playbackRate for its "sync", which
   * vidstack's own internal signal had not yet caught up to, clobbering the just-set rate back to
   * its old value. Scoping each handler to only the field its own event reports removes the
   * cross-contamination entirely.
   */
  function syncVolumeFromPlayer(): void {
    const state = playerRef.current?.state;
    if (!state) return;
    setPlayerVolume(state.volume);
    setPlayerMuted(state.muted);
  }

  function syncRateFromPlayer(): void {
    const state = playerRef.current?.state;
    if (!state) return;
    setPlayerRate(state.playbackRate);
  }

  /**
   * A bare `playerRef.current?.play()` can reject with "media is not ready - wait for `can-play`
   * event" if the click lands before the provider has buffered enough to play -- entirely
   * possible on any real network, not just a test artifact (confirmed: this raced and failed
   * intermittently, both in tests/e2e/player.spec.ts locally and, very likely, in CI, before this
   * fix). `canPlayQueue.waitForFlush()` is vidstack's own primitive for exactly this: it resolves
   * once the player can actually play, immediately if it already can. The catch is deliberate --
   * an autoplay-policy rejection here just means the click didn't count as a user gesture in some
   * edge case; there's nothing more to do about it.
   */
  async function handlePlayClick(): Promise<void> {
    const player = playerRef.current;
    if (!player) return;
    try {
      await player.canPlayQueue.waitForFlush();
      await player.play();
    } catch {
      // Intentionally swallowed -- see the comment above.
    }
  }

  /**
   * `,`/`.` frame-stepping while paused -- not one of vidstack's own MEDIA_KEY_SHORTCUTS
   * (confirmed: togglePaused/toggleMuted/toggleFullscreen/seekBackward(5s)/seekForward(5s)/
   * volume are built in, but there's no frame-step binding), so this is custom. Attached as a
   * plain onKeyDown on the container: keydown bubbles from whichever descendant vidstack made
   * focusable, and React's synthetic event delegation catches it here without needing our own
   * tabIndex on the container.
   */
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (!paused) return;
    if (e.key === ',') {
      e.preventDefault();
      void stepFrames(-1);
    } else if (e.key === '.') {
      e.preventDefault();
      void stepFrames(1);
    }
  }

  if (!source) {
    return <div className="grid h-full place-items-center rounded-token-lg border border-line bg-surface text-ink-3">No video loaded</div>;
  }

  return (
    <MediaPlayer
      ref={playerRef}
      className="flex w-full flex-col"
      title={source.title}
      src={source.mimeType ? { src: source.src, type: source.mimeType as VideoMimeType } : source.src}
      viewType="video"
      streamType="on-demand"
      logLevel="warn"
      crossOrigin
      playsInline
      onKeyDown={handleKeyDown}
      onTimeUpdate={(detail) => {
        setCurrentTime(detail.currentTime);
        // set_playback's {loop:{start,end}} (Task 4): a timeupdate guard that seeks back to
        // `start` once the playhead reaches `end`, per the plan's own stated approach -- vidstack
        // has no built-in A/B loop concept, so this has to live at the same event that already
        // drives currentTime.
        if (loop && detail.currentTime >= loop.end) {
          void seek(loop.start);
        }
      }}
      onLoadedMetadata={handleLoadedMetadata}
      onPlay={() => {
        setPaused(false);
        setHasPlayed(true);
      }}
      onPause={() => setPaused(true)}
      onVolumeChange={syncVolumeFromPlayer}
      onRateChange={syncRateFromPlayer}
      onEnd={() => {
        syncVolumeFromPlayer();
        syncRateFromPlayer();
      }}
    >
      <div
        ref={containerRef}
        data-testid="video-stage"
        className="relative aspect-video overflow-hidden rounded-token-lg bg-ink"
      >
        {/* The <video> must fill this container exactly: every overlay (BoxOverlay/MaskOverlay/
            PoseOverlay/BoxDrawLayer) is positioned as a percentage of it, so a video left at its
            intrinsic size (Tailwind's preflight only caps it at max-width) sits off from its own
            boxes whenever it is smaller than the stage. object-contain letterboxes any other
            aspect ratio inside the same rect. */}
        <MediaProvider className="[&_video]:absolute [&_video]:inset-0 [&_video]:h-full [&_video]:w-full [&_video]:max-w-none [&_video]:object-contain">
          <Track key={chaptersVttUrl} src={chaptersVttUrl} kind="chapters" label="Chapters" language="en-US" default />
        </MediaProvider>
        <FrameLabel chapter={activeChapter} index={activeIndex} />
        <FrameTitle title={activeChapter?.title ?? ''} hidden={!paused && hasPlayed} />
        <MaskOverlay />
        <BoxOverlay />
        <PoseOverlay />
        <BoxDrawLayer />
        <SegmentClickLayer />
        <PlayOverlay hidden={hasPlayed} onPlay={() => void handlePlayClick()} />
        <Chrome playerRef={playerRef} containerRef={containerRef} />
      </div>
      {source.filmstripUrls && <Filmstrip urls={source.filmstripUrls} />}
      {spriteUrl && <Filmstrip sprite={{ url: spriteUrl, tiles: filmstripTiles }} />}
      {/* Timeline uses vidstack's TimeSlider, which needs to be inside MediaPlayer's context
          tree to read player state -- it must stay a MediaPlayer child, not a page-level sibling
          (ported layout from ../agent-video-player/VideoStage.tsx:202-204). */}
      <div className="mt-3.5">
        <Timeline />
      </div>
    </MediaPlayer>
  );
}
