/**
 * Pure merge logic for Task 8's audio-event tools (`find_speaker_turns`, `tag_audio_events`) --
 * kept out of `ml/audio-events.worker.ts` so it's unit-testable without a real pyannote/AST model,
 * same split as media/dhash.ts+media/scenes.ts's pure/impure separation.
 */

export interface RawSpeakerSegment {
  /** pyannote's own frame-classification channel index (a local speaker slot within this run, not
   * a stable global identity). */
  id: number;
  start: number;
  end: number;
  confidence: number;
}

export interface SpeakerTurn {
  speaker: string;
  start: number;
  end: number;
  confidence: number;
}

/** Two consecutive turns from the same speaker channel closer together than this are one
 * continuous turn, not two -- per the plan's own "merged gaps < 0.3s" Key Decision. */
const SPEAKER_MERGE_GAP_SECONDS = 0.3;

/**
 * Converts pyannote's raw per-channel segments (already time-sorted by
 * `processor.post_process_speaker_diarization`, but merged here defensively regardless) into
 * `find_speaker_turns`'s own `SPEAKER_00`-style output, merging consecutive same-speaker segments
 * separated by a gap under {@link SPEAKER_MERGE_GAP_SECONDS}.
 */
export function mergeSpeakerTurns(segments: RawSpeakerSegment[]): SpeakerTurn[] {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const turns: SpeakerTurn[] = [];

  for (const seg of sorted) {
    const speaker = `SPEAKER_${String(seg.id).padStart(2, '0')}`;
    const last = turns[turns.length - 1];
    if (last && last.speaker === speaker && seg.start - last.end < SPEAKER_MERGE_GAP_SECONDS) {
      last.end = seg.end;
      last.confidence = Math.max(last.confidence, seg.confidence);
    } else {
      turns.push({ speaker, start: seg.start, end: seg.end, confidence: seg.confidence });
    }
  }

  return turns;
}

export interface RawWindowEvent {
  start: number;
  end: number;
  label: string;
  score: number;
}

export type AudioEvent = RawWindowEvent;

/**
 * `tag_audio_events` classifies overlapping windows independently (10s window, 5s hop -- see
 * ml/audio-events.worker.ts), so the SAME label commonly appears in several consecutive windows'
 * top-K results. Merges consecutive/overlapping same-label entries into one contiguous event
 * span, per the plan's own "adjacent equal labels merged" Key Decision.
 */
export function mergeAdjacentAudioEvents(events: RawWindowEvent[]): AudioEvent[] {
  const sorted = [...events].sort((a, b) => a.start - b.start || a.label.localeCompare(b.label));
  const merged: AudioEvent[] = [];

  for (const event of sorted) {
    const last = merged[merged.length - 1];
    if (last && last.label === event.label && event.start <= last.end) {
      last.end = Math.max(last.end, event.end);
      last.score = Math.max(last.score, event.score);
    } else {
      merged.push({ ...event });
    }
  }

  return merged;
}
