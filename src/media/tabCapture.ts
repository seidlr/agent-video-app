/**
 * Chromium-desktop-only fallback for capturing pixels from a YouTube source, where no direct
 * byte/pixel access exists across the iframe (Global Constraints; see also getInput's guard).
 * Requires a user gesture (the plan's TabCaptureButton) -- getDisplayMedia() always does.
 */

export interface TabCaptureSession {
  stream: MediaStream;
  video: HTMLVideoElement;
  stop(): void;
}

/** The one active session, if any. A module-level singleton (like input.ts's Input cache and
 * studio.ts's playerHandle) rather than store state: capture_frame's tool handler needs to read
 * the live `<video>` element itself, which isn't serializable/comparable zustand state, and only
 * one tab-capture session can be meaningful at a time anyway. */
let activeSession: TabCaptureSession | null = null;

export function getActiveTabCapture(): TabCaptureSession | null {
  return activeSession;
}

/** Starts a screen/tab capture and returns a hidden, already-playing `<video>` bound to the
 * chosen surface, so capture.ts's captureCurrentFrame can read frames from it exactly like any
 * other video element. Prefers the current tab (`selfBrowserSurface:'exclude'` steers Chromium's
 * picker away from suggesting "this tab" as a confusing option -- the user picks the tab actually
 * playing the video, typically a different one for YouTube -- while `surfaceSwitching:'include'`
 * lets them switch the captured surface later without restarting). Stops any previous session
 * first -- only one is meaningful at a time. */
export async function startTabCapture(): Promise<TabCaptureSession> {
  stopTabCapture();

  const mediaDevices = navigator.mediaDevices as MediaDevices & {
    getDisplayMedia(options?: DisplayMediaStreamOptions & Record<string, unknown>): Promise<MediaStream>;
  };
  const stream = await mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    monitorTypeSurfaces: 'exclude',
  });

  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();

  function stop(): void {
    for (const track of stream.getTracks()) track.stop();
    video.pause();
    video.srcObject = null;
    if (activeSession?.video === video) activeSession = null;
  }

  // If the user stops sharing via the browser's own UI (not our stop button), clean up the
  // <video> the same way so a later capture attempt doesn't read from a dead stream.
  stream.getVideoTracks()[0]?.addEventListener('ended', stop, { once: true });

  activeSession = { stream, video, stop };
  return activeSession;
}

/** Stops the active session, if any. Safe to call when nothing is active. */
export function stopTabCapture(): void {
  activeSession?.stop();
  activeSession = null;
}
