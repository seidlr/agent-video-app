import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { ScreenShare, ScreenShareOff } from 'lucide-react';
import { startTabCapture, stopTabCapture } from '../../media/tabCapture';

/**
 * Chromium-desktop-only fallback for YouTube frame capture (media/tabCapture.ts): a YouTube
 * iframe's pixels are cross-origin and unreachable, so capture_frame otherwise returns
 * `youtube_pixels_unavailable`. getDisplayMedia() requires a user gesture, so this button (shown
 * only for a YouTube source; see Chrome.tsx) is the only way to arm it -- once active, the tools/
 * frames.ts capture_frame handler reads from the singleton session's <video> instead.
 */
export function TabCaptureButton(): ReactElement {
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState(false);

  // Stop the shared session if this button unmounts (e.g. the source changed away from YouTube)
  // while it was active -- a capture no one can see or stop from the UI anymore is not useful.
  useEffect(() => {
    return () => {
      if (active) stopTabCapture();
    };
  }, [active]);

  async function handleClick(): Promise<void> {
    if (active) {
      stopTabCapture();
      setActive(false);
      return;
    }
    setPending(true);
    try {
      const session = await startTabCapture();
      setActive(true);
      // Covers the user stopping the share via the browser's own "Stop sharing" UI rather than
      // this button -- tabCapture.ts's own stop() already tears the session down either way.
      session.stream.getVideoTracks()[0]?.addEventListener('ended', () => setActive(false), { once: true });
    } catch {
      // The user dismissed the picker, or getDisplayMedia isn't supported here -- nothing to do.
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={pending}
      aria-label={active ? 'Stop tab capture' : 'Enable tab capture for frame capture'}
      title="Chromium desktop only · captures the picked tab · check the source's terms"
      className={`grid h-[30px] w-[30px] place-items-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? 'bg-warn/25 text-warn' : 'text-white/85 hover:bg-white/15'
      }`}
    >
      {active ? <ScreenShareOff size={16} /> : <ScreenShare size={16} />}
    </button>
  );
}
