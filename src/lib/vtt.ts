import { formatTime, parseTime } from './time';

export interface VttCue {
  start: number;
  end: number;
  text: string;
}

const ZERO_CTX = { duration: 0, currentTime: 0 };

/**
 * Parses a WEBVTT file's cues into numeric {start,end,text} tuples. Reuses parseTime's own
 * timecode regex (rather than a second, stricter one) so both "H:MM:SS.mmm" and the common,
 * technically-non-standard-but-universal-for-under-an-hour-media "M:SS(.mmm)" forms work --
 * ported from ../agent-video-player/src/lib/vtt.ts:11-30's parseVtt/timeToSecs, with two real
 * fixes: that version's timeToSecs only accepted exactly 3 ":"-separated parts (no bare M:SS),
 * and its cue text was only ever the single line right after the timestamp -- a VTT cue's payload
 * can legally span multiple lines up to the next blank line or timestamp line, which this joins.
 * Also strips VTT cue *settings* after the end timestamp (e.g. "... --> 00:00:05.000 align:start
 * line:0"), which the old version never had to handle since it always wrote its own VTT.
 */
export function parseVtt(content: string): VttCue[] {
  const cues: VttCue[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (!line.includes('-->')) continue;

    const [startRaw, afterArrow] = line.split('-->');
    const endRaw = (afterArrow ?? '').trim().split(/\s+/)[0];
    const start = parseTime((startRaw ?? '').trim(), ZERO_CTX);
    const end = parseTime(endRaw ?? '', ZERO_CTX);
    if (start === null || end === null) continue;

    const textLines: string[] = [];
    let j = i + 1;
    while (j < lines.length && (lines[j] as string).trim() !== '' && !(lines[j] as string).includes('-->')) {
      textLines.push(lines[j] as string);
      j++;
    }
    cues.push({ start, end, text: textLines.join('\n').trim() });
    i = j - 1;
  }

  return cues;
}

/** Builds a WEBVTT document from cues, using the same HH:MM:SS.mmm timestamp format everywhere
 * else in the app (lib/time.ts's formatTime) -- ported from
 * ../agent-video-player/src/lib/vtt.ts:32-38's buildVttString, generalized from chapter-only
 * `{start,end,title}` inputs to any `{start,end,text}` cue so notes/exports can reuse it too. */
export function buildVttString(cues: { start: number; end: number; text: string }[]): string {
  if (cues.length === 0) return 'WEBVTT\n';
  const body = cues.map((c) => `${formatTime(c.start)} --> ${formatTime(c.end)}\n${c.text}`).join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}
