import { extractAudioPcm } from '../../media/audio';
import { mergeAdjacentAudioEvents, mergeSpeakerTurns, type RawSpeakerSegment, type RawWindowEvent } from '../../media/audioEvents';
import { mlClient } from '../../ml/client';
import { parseTime, secsToTimecode } from '../../lib/time';
import type { StudioStore } from '../../store/studio';
import type { Registry, ToolResult } from '../registry';

type FindSpeakerTurnsArgs = { from?: string | number; to?: string | number; addNotes?: boolean; confirmDownload?: boolean } & Record<string, unknown>;
type TagAudioEventsArgs = {
  from?: string | number;
  to?: string | number;
  threshold?: number;
  addChapters?: boolean;
  confirmDownload?: boolean;
} & Record<string, unknown>;

/** Resolves [from,to] against the current player state, extracts 16kHz PCM for that range, and
 * runs the confirmDownload/model_not_loaded gate for `modelId` -- the shared setup both audio
 * tools below need before calling into their own worker RPC method. */
async function prepareAudioCall(
  store: StudioStore,
  modelId: string,
  args: { from?: string | number; to?: string | number; confirmDownload?: boolean },
): Promise<{ ok: true; samples: Float32Array; from: number; worker: import('../../ml/client').MlWorker } | { ok: false; result: ToolResult }> {
  const state = store.getState();
  if (!state.source) return { ok: false, result: { ok: false, error: 'no_video_loaded' } };
  if (state.source.kind === 'youtube') {
    return { ok: false, result: { ok: false, error: 'audio_analysis_unavailable_on_youtube', hint: 'Needs direct audio access; not available for a YouTube source.' } };
  }

  const timeCtx = { currentTime: state.player.currentTime, duration: state.player.duration, fps: state.player.fps };
  const from = args.from !== undefined ? parseTime(args.from, timeCtx) : 0;
  const to = args.to !== undefined ? parseTime(args.to, timeCtx) : state.player.duration;
  if (from === null || to === null) {
    return { ok: false, result: { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' } };
  }
  if (to <= from) return { ok: false, result: { ok: false, error: 'invalid_range', hint: '`to` must be after `from`.' } };

  const ensured = await mlClient.ensureModel(modelId, {
    confirmDownload: args.confirmDownload,
    onProgress: (fraction) => store.getState().setModelState(modelId, { progress: fraction }),
  });
  if (!ensured.ok) {
    if (ensured.error === 'unknown_model') return { ok: false, result: { ok: false, error: 'unknown_model', hint: `no model with id "${modelId}"` } };
    return { ok: false, result: { ok: false, error: ensured.error, hint: ensured.hint } };
  }
  store.getState().setModelState(modelId, { loaded: true, cached: true, progress: 1 });

  try {
    const { samples } = await extractAudioPcm(state.source, { start: from, end: to });
    return { ok: true, samples, from, worker: ensured.worker };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('no_audio_track')) {
      return { ok: false, result: { ok: false, error: 'no_audio_track', hint: 'This source has no audio track to analyze.' } };
    }
    throw error;
  }
}

/** audio tools: find_speaker_turns (pyannote), tag_audio_events (AST). Both `local` (need direct
 * audio access) and job-mode (real ML inference over the whole clip can take a while). */
export function defineAudioTools(registry: Registry, store: StudioStore): void {
  registry.define<FindSpeakerTurnsArgs>({
    name: 'find_speaker_turns',
    description:
      'Detects speaker-change turns in the audio (pyannote speaker diarization), merging consecutive same-speaker segments separated by a gap under 0.3s. Optionally adds a region note per turn.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: ['string', 'number'] },
        to: { type: ['string', 'number'] },
        addNotes: { type: 'boolean' },
        confirmDownload: { type: 'boolean' },
      },
    },
    group: 'audio',
    when: 'local',
    mode: 'job',
    handler: async (args): Promise<ToolResult> => {
      const prepared = await prepareAudioCall(store, 'pyannote-segmentation', args);
      if (!prepared.ok) return prepared.result;

      const raw = await prepared.worker.call<RawSpeakerSegment[]>('find_speaker_turns', { samples: prepared.samples });
      const turns = mergeSpeakerTurns(raw.map((r) => ({ ...r, start: r.start + prepared.from, end: r.end + prepared.from })));

      let notesAdded = 0;
      if (args.addNotes) {
        for (const turn of turns) {
          store.getState().addNote({ time: turn.start, end: turn.end, text: `${turn.speaker} speaking`, tags: ['speaker'], createdBy: 'agent' });
          notesAdded++;
        }
      }

      return {
        ok: true,
        summary: `${turns.length} speaker turn(s)${notesAdded > 0 ? `, added ${notesAdded} note(s)` : ''}`,
        turns,
      };
    },
  });

  registry.define<TagAudioEventsArgs>({
    name: 'tag_audio_events',
    description:
      'Tags audio events (speech, music, environmental sounds, ...) over the clip using a 10s sliding window (AST audio classification), merging adjacent windows that agree on a label. Optionally adds a chapter at each label change.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: ['string', 'number'] },
        to: { type: ['string', 'number'] },
        threshold: { type: 'number', minimum: 0, maximum: 1 },
        addChapters: { type: 'boolean' },
        confirmDownload: { type: 'boolean' },
      },
    },
    group: 'audio',
    when: 'local',
    mode: 'job',
    handler: async (args): Promise<ToolResult> => {
      const prepared = await prepareAudioCall(store, 'ast-audio-events', args);
      if (!prepared.ok) return prepared.result;

      const raw = await prepared.worker.call<RawWindowEvent[]>('tag_audio_events', { samples: prepared.samples, threshold: args.threshold });
      const events = mergeAdjacentAudioEvents(raw.map((e) => ({ ...e, start: e.start + prepared.from, end: e.end + prepared.from })));

      let chaptersAdded = 0;
      if (args.addChapters) {
        for (const event of events) {
          try {
            store.getState().addChapter({ start: event.start, end: event.end, title: event.label });
            chaptersAdded++;
          } catch {
            // Overlaps an existing chapter -- skip it rather than fail the whole tagging result.
          }
        }
      }

      return {
        ok: true,
        summary: `${events.length} event(s) from ${secsToTimecode(prepared.from)}${chaptersAdded > 0 ? `, added ${chaptersAdded} chapter(s)` : ''}`,
        events,
      };
    },
  });
}
