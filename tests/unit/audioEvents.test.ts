import { describe, expect, it } from 'vitest';
import { mergeAdjacentAudioEvents, mergeSpeakerTurns } from '../../src/media/audioEvents';

describe('mergeSpeakerTurns (Task 8 DoD: audio-events)', () => {
  it('merges two same-speaker segments separated by a gap under 0.3s into one turn', () => {
    const turns = mergeSpeakerTurns([
      { id: 0, start: 0, end: 1.0, confidence: 0.8 },
      { id: 0, start: 1.2, end: 2.5, confidence: 0.9 },
    ]);
    expect(turns).toEqual([{ speaker: 'SPEAKER_00', start: 0, end: 2.5, confidence: 0.9 }]);
  });

  it('does NOT merge across a gap of 0.3s or more', () => {
    const turns = mergeSpeakerTurns([
      { id: 0, start: 0, end: 1.0, confidence: 0.8 },
      { id: 0, start: 1.3, end: 2.5, confidence: 0.9 },
    ]);
    expect(turns).toHaveLength(2);
  });

  it('does not merge across different speaker channels even with zero gap', () => {
    const turns = mergeSpeakerTurns([
      { id: 0, start: 0, end: 1.0, confidence: 0.8 },
      { id: 1, start: 1.0, end: 2.0, confidence: 0.7 },
    ]);
    expect(turns.map((t) => t.speaker)).toEqual(['SPEAKER_00', 'SPEAKER_01']);
  });

  it('sorts out-of-order input by start time before merging', () => {
    const turns = mergeSpeakerTurns([
      { id: 0, start: 5, end: 6, confidence: 0.5 },
      { id: 0, start: 0, end: 1, confidence: 0.5 },
    ]);
    expect(turns[0]!.start).toBe(0);
    expect(turns[1]!.start).toBe(5);
  });
});

describe('mergeAdjacentAudioEvents (Task 8 DoD: audio-events)', () => {
  it('merges the same label across two overlapping windows into one contiguous event', () => {
    const events = mergeAdjacentAudioEvents([
      { start: 0, end: 10, label: 'Speech', score: 0.6 },
      { start: 5, end: 15, label: 'Speech', score: 0.8 },
    ]);
    expect(events).toEqual([{ start: 0, end: 15, label: 'Speech', score: 0.8 }]);
  });

  it('keeps different labels in the same window separate', () => {
    const events = mergeAdjacentAudioEvents([
      { start: 0, end: 10, label: 'Speech', score: 0.6 },
      { start: 0, end: 10, label: 'Music', score: 0.4 },
    ]);
    expect(events).toHaveLength(2);
  });

  it('does not merge the same label across a real gap (non-overlapping, non-adjacent windows)', () => {
    const events = mergeAdjacentAudioEvents([
      { start: 0, end: 10, label: 'Speech', score: 0.6 },
      { start: 20, end: 30, label: 'Speech', score: 0.7 },
    ]);
    expect(events).toHaveLength(2);
  });
});
