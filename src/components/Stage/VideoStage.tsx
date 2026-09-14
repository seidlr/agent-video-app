import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { MediaPlayer, MediaProvider, type MediaPlayerInstance, type VideoMimeType } from '@vidstack/react';
import { BoxOverlay } from './BoxOverlay';
import { Chrome } from './Chrome';
import { FrameLabel } from './FrameLabel';
import { FrameTitle } from './FrameTitle';
import { PlayOverlay } from './PlayOverlay';
import { Filmstrip } from '../Timeline/Filmstrip';
import { Timeline } from '../Timeline/Timeline';
import { updateAssetMetadata } from '../../store/library';
import { useStudio } from '../../store/studio';

/**
 * Ported from ../agent-video-player/src/components/VideoStage/VideoStage.tsx:166-206 and
 * Chrome.tsx, adapted to the new store and stripped of Firebase session sync (Task 2's
 * Out of Scope; this app is front-end only). Duration/dimensions are captured via
 * onLoadedMetadata/onDurationChange when they fire in time, with a self-healing catch-up in
 * onTimeUpdate for when they don't (see captureMetadataOnce) -- see that function's comment for
 * why the old project's 500ms setInterval poll (VideoStage.tsx:82-91) couldn't simply be dropped.
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

  const activeChapter = chapters.find((c) => currentTime >= c.start && currentTime <= c.end) ?? null;
  const activeIndex = activeChapter ? Math.max(0, chapters.indexOf(activeChapter)) : 0;

  useEffect(() => {
    registerPlayer(playerRef.current);
    return () => registerPlayer(null);
  }, [registerPlayer, source]);

  const metadataAppliedRef = useRef(false);
  useEffect(() => {
    metadataAppliedRef.current = false;
  }, [source]);

  /**
   * `loadedmetadata`/`duration-change` are one-shot events that can fire before React's
   * vidstack-react event bridge finishes attaching its listeners (confirmed empirically: with
   * only onLoadedMetadata/onDurationChange wired, duration/width/height stayed 0 even though
   * the underlying <video> reached readyState 4 with the correct duration). onTimeUpdate fires
   * repeatedly, so applying the same metadata capture there is a reliable self-healing catch-up
   * -- this replaces the old project's 500ms setInterval poll (VideoStage.tsx:82-91) without
   * reintroducing a timer.
   */
  function captureMetadataOnce(): void {
    if (metadataAppliedRef.current) return;
    const state = playerRef.current?.state;
    if (!state?.duration) return;
    metadataAppliedRef.current = true;
    setDuration(state.duration);
    setDimensions(state.width || 0, state.height || 0);

    if (source?.kind === 'file' && source.assetId) {
      void updateAssetMetadata(source.assetId, { duration: state.duration, width: state.width || 0, height: state.height || 0 });
    }
  }

  function handleLoadedMetadata(): void {
    captureMetadataOnce();

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

  function syncFromPlayer(): void {
    const state = playerRef.current?.state;
    if (!state) return;
    setPlayerVolume(state.volume);
    setPlayerMuted(state.muted);
    setPlayerRate(state.playbackRate);
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
        captureMetadataOnce();
      }}
      onLoadedMetadata={handleLoadedMetadata}
      onDurationChange={() => captureMetadataOnce()}
      onPlay={() => {
        setPaused(false);
        setHasPlayed(true);
      }}
      onPause={() => setPaused(true)}
      onVolumeChange={syncFromPlayer}
      onRateChange={syncFromPlayer}
      onEnd={syncFromPlayer}
    >
      <div
        ref={containerRef}
        className="relative aspect-video overflow-hidden rounded-token-lg bg-ink"
      >
        <MediaProvider />
        <FrameLabel chapter={activeChapter} index={activeIndex} />
        <FrameTitle title={activeChapter?.title ?? ''} hidden={!paused && hasPlayed} />
        <BoxOverlay />
        <PlayOverlay hidden={hasPlayed} onPlay={() => void playerRef.current?.play()} />
        <Chrome playerRef={playerRef} containerRef={containerRef} />
      </div>
      {source.filmstripUrls && <Filmstrip urls={source.filmstripUrls} />}
      {/* Timeline uses vidstack's TimeSlider, which needs to be inside MediaPlayer's context
          tree to read player state -- it must stay a MediaPlayer child, not a page-level sibling
          (ported layout from ../agent-video-player/VideoStage.tsx:202-204). */}
      <div className="mt-3.5">
        <Timeline />
      </div>
    </MediaPlayer>
  );
}
