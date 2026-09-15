/** The vidstack player renders a single `<video>` inside the element carrying this attribute
 * (VideoStage.tsx); there is only ever one active player in this app. Returns null for a YouTube
 * source (an iframe, not a `<video>`) or before the player has mounted. Shared by every tool that
 * needs the live video element (tools/frames.ts's capture_frame, tools/vision.ts's segment) so
 * there is exactly one query selector to keep in sync with VideoStage.tsx's markup. Ported in
 * spirit from ../agent-video-player/src/VideoContext.tsx:163-174's element lookup. */
export function getVideoElement(): HTMLVideoElement | null {
  return document.querySelector('[data-media-player] video');
}
