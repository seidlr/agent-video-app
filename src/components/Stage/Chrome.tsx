import { useEffect, useRef, useState } from 'react';
import type { ReactElement, RefObject } from 'react';
import type { MediaPlayerInstance } from '@vidstack/react';
import { Captions, Maximize2, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { secsToTimecode } from '../../lib/time';
import { useStudio } from '../../store/studio';
import { TabCaptureButton } from './TabCaptureButton';

export interface ChromeProps {
  playerRef: RefObject<MediaPlayerInstance | null>;
  containerRef: RefObject<HTMLDivElement | null>;
}

const SPEED_OPTIONS = [0.5, 1, 1.5, 2] as const;

// Vidstack API verified against the installed @vidstack/react@1.15.6 type declarations:
//   - MediaPlayerInstance.enterFullscreen()/exitFullscreen(): Promise<void>
//   - MediaPlayerInstance.textTracks: TextTrackList (List.toArray(), List.getById())
// Fullscreen falls back to the native DOM API if the Vidstack call rejects.
export function Chrome({ playerRef, containerRef }: ChromeProps): ReactElement {
  const paused = useStudio((s) => s.player.paused);
  const currentTime = useStudio((s) => s.player.currentTime);
  const duration = useStudio((s) => s.player.duration);
  const muted = useStudio((s) => s.player.muted);
  const rate = useStudio((s) => s.player.rate);
  const isYoutube = useStudio((s) => s.source?.kind === 'youtube');
  const togglePlay = useStudio((s) => s.togglePlay);
  const setPlayerRate = useStudio((s) => s.setPlayerRate);
  const setPlayerMuted = useStudio((s) => s.setPlayerMuted);

  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [hasCaptions, setHasCaptions] = useState(false);
  const speedMenuRef = useRef<HTMLDivElement>(null);

  // Detect captions availability (the chapters track is NOT a captions track).
  useEffect(() => {
    const interval = setInterval(() => {
      const tracks = playerRef.current?.textTracks;
      if (tracks) {
        const captionTrack = tracks.toArray().find((t) => t.kind === 'captions' || t.kind === 'subtitles');
        setHasCaptions(captionTrack !== undefined);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [playerRef]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (speedMenuRef.current && !speedMenuRef.current.contains(e.target as Node)) {
        setShowSpeedMenu(false);
      }
    }
    if (showSpeedMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSpeedMenu]);

  function pickSpeed(speed: number): void {
    setPlayerRate(speed);
    setShowSpeedMenu(false);
  }

  function toggleCaptions(): void {
    if (!hasCaptions) return;
    const tracks = playerRef.current?.textTracks;
    if (!tracks) return;
    const captionTrack = tracks.toArray().find((t) => t.kind === 'captions' || t.kind === 'subtitles');
    if (!captionTrack) return;
    const next = !captionsOn;
    captionTrack.setMode(next ? 'showing' : 'disabled');
    setCaptionsOn(next);
  }

  async function toggleFullscreen(): Promise<void> {
    const player = playerRef.current;
    if (!player) return;
    try {
      if (document.fullscreenElement) {
        await player.exitFullscreen();
      } else {
        await player.enterFullscreen();
      }
    } catch {
      if (document.fullscreenElement) {
        void document.exitFullscreen?.();
      } else {
        void containerRef.current?.requestFullscreen?.();
      }
    }
  }

  return (
    <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-b from-transparent to-black/55 px-4 pt-3.5 pb-3 text-white/90">
      <button
        type="button"
        onClick={() => void togglePlay()}
        aria-label={paused ? 'Play' : 'Pause'}
        className="grid h-[30px] w-[30px] place-items-center rounded-md text-white/90 transition-colors hover:bg-white/15"
      >
        {paused ? <Play size={16} fill="currentColor" className="ml-[1px]" /> : <Pause size={16} fill="currentColor" />}
      </button>
      <span className="min-w-[96px] font-mono text-[11px] text-white/85">
        {secsToTimecode(currentTime)} <span className="text-white/50">/ {secsToTimecode(duration)}</span>
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        <div className="relative" ref={speedMenuRef}>
          <button
            type="button"
            onClick={() => setShowSpeedMenu((s) => !s)}
            className="rounded bg-white/10 px-1.5 py-1 font-mono text-[10.5px] text-white/85 transition-colors hover:bg-white/20"
            aria-label="Playback speed"
          >
            {rate}×
          </button>
          {showSpeedMenu && (
            <div className="absolute right-0 bottom-full mb-2 flex min-w-16 flex-col rounded-lg border border-line bg-surface p-1 text-ink shadow-lg">
              {SPEED_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => pickSpeed(s)}
                  className={`rounded px-2 py-1 text-left font-mono text-[12px] hover:bg-surface-2 ${rate === s ? 'font-semibold text-clay' : 'text-ink-2'}`}
                >
                  {s}×
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={toggleCaptions}
          aria-label={hasCaptions ? (captionsOn ? 'Hide captions' : 'Show captions') : 'No captions available'}
          title={hasCaptions ? undefined : 'No captions on this video'}
          disabled={!hasCaptions}
          className={`grid h-[30px] w-[30px] place-items-center rounded-md transition-colors ${hasCaptions ? 'text-white/85 hover:bg-white/15' : 'cursor-not-allowed text-white/30'} ${captionsOn ? 'bg-white/20 text-white' : ''}`}
        >
          <Captions size={16} strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => setPlayerMuted(!muted)}
          aria-label={muted ? 'Unmute' : 'Mute'}
          className="grid h-[30px] w-[30px] place-items-center rounded-md text-white/85 transition-colors hover:bg-white/15"
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <button
          type="button"
          onClick={() => void toggleFullscreen()}
          aria-label="Fullscreen"
          className="grid h-[30px] w-[30px] place-items-center rounded-md text-white/85 transition-colors hover:bg-white/15"
        >
          <Maximize2 size={16} />
        </button>
        {isYoutube && <TabCaptureButton />}
      </div>
    </div>
  );
}
