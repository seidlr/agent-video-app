import type { ExportContext } from './types';

/** CMX3600's HH:MM:SS:FF timecode -- frame-accurate, at `fps`, non-drop-frame (this app never
 * targets the broadcast 29.97fps rates drop-frame exists for). `1.5s @ 30fps` -> 45 frames ->
 * 1s + 15 frames -> "00:00:01:15". */
export function secondsToEdlTimecode(secs: number, fps: number): string {
  const totalFrames = Math.round(Math.max(0, secs) * fps);
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}

/** CMX3600 EDL: `TITLE:`/`FCM: NON-DROP FRAME` header, then one `V C` (video, cut) event per clip
 * when clips exist, else one per chapter -- per the plan's Task 6 Key Decisions. Source and record
 * timecodes are identical for every event: without a real source tape/original capture timeline,
 * there is nothing else meaningful to put in the source columns, and a plain "record == source"
 * EDL is still valid CMX3600 and imports cleanly into any NLE. */
export function exportEdl(ctx: ExportContext): string {
  const ranges: { start: number; end: number; name: string }[] =
    ctx.clips && ctx.clips.length > 0
      ? [...ctx.clips].sort((a, b) => a.order - b.order).map((c) => ({ start: c.start, end: c.end, name: c.name ?? ctx.asset.title }))
      : [...ctx.chapters].sort((a, b) => a.start - b.start).map((c) => ({ start: c.start, end: c.end, name: c.title }));

  const events = ranges.map((r, index) => {
    const num = String(index + 1).padStart(3, '0');
    const inTc = secondsToEdlTimecode(r.start, ctx.fps);
    const outTc = secondsToEdlTimecode(r.end, ctx.fps);
    return `${num}  AX       V     C        ${inTc} ${outTc} ${inTc} ${outTc}\n* FROM CLIP NAME: ${r.name}`;
  });

  const header = `TITLE: ${ctx.asset.title}\nFCM: NON-DROP FRAME`;
  return events.length > 0 ? `${header}\n\n${events.join('\n\n')}\n` : `${header}\n`;
}
