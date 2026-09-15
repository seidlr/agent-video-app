import { extractAudioPcm } from '../../media/audio';
import { mlClient } from '../../ml/client';
import { buildSrtString } from '../../lib/exports/srt';
import { parseTime, secsToTimecode } from '../../lib/time';
import type { TranscriptSegment } from '../../lib/types';
import { buildVttString } from '../../lib/vtt';
import { getPersistedTranscript, persistTranscript } from '../../store/transcript';
import type { StudioStore } from '../../store/studio';
import type { Registry, ToolResult } from '../registry';

/** `transcribe`'s tier -> catalog id map. Only `tiny`/`base` exist yet -- `turbo` (accuracy tier)
 * and `moonshine` (short-range, no 30s padding) are Task 13's own additions to this same map,
 * per the plan's "Modify: ml/catalog.ts, transcribe.worker.ts (tiers tiny|base|turbo|moonshine)". */
const TIER_TO_MODEL_ID: Record<'tiny' | 'base', string> = { tiny: 'whisper-tiny', base: 'whisper-base' };

interface WorkerTranscribeResult {
  segments: TranscriptSegment[];
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Replaces only the segments overlapping [from,to) -- a range re-transcription (or Task 13's
 * Moonshine short-range tier) corrects just that stretch instead of discarding the rest of an
 * already-transcribed video. A full-video call (from:0, to:duration) naturally clears everything
 * that was there before, since every existing segment overlaps that range. */
function mergeSegments(existing: TranscriptSegment[], from: number, to: number, replacement: TranscriptSegment[]): TranscriptSegment[] {
  const kept = existing.filter((s) => !overlaps(s.start, s.end, from, to));
  return [...kept, ...replacement].sort((a, b) => a.start - b.start);
}

type TranscribeArgs = {
  model?: 'tiny' | 'base';
  from?: string | number;
  to?: string | number;
  language?: string;
  confirmDownload?: boolean;
} & Record<string, unknown>;

type GetTranscriptArgs = {
  from?: string | number;
  to?: string | number;
  format?: 'text' | 'segments' | 'srt' | 'vtt';
  lang?: string;
} & Record<string, unknown>;

type SearchTranscriptArgs = { query: string; lang?: string } & Record<string, unknown>;

/**
 * transcript tools: transcribe (`local`, job-mode -- real ASR inference), get_transcript/
 * search_transcript (`after-transcribe` -- see agent/webmcp.ts's own transcript-aware
 * registration). `translate_transcript` is Task 13's addition to this same group.
 */
export function defineTranscriptTools(registry: Registry, store: StudioStore): void {
  registry.define<TranscribeArgs>({
    name: 'transcribe',
    description:
      "Transcribes the video's audio with Whisper, adding timestamped segments to the transcript. First call without confirmDownload to see the model size. Omit from/to to transcribe the whole video; a partial range replaces only the overlapping segments.",
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string', enum: ['tiny', 'base'] },
        from: { type: ['string', 'number'] },
        to: { type: ['string', 'number'] },
        language: { type: 'string' },
        confirmDownload: { type: 'boolean' },
      },
    },
    group: 'transcript',
    when: 'local',
    mode: 'job',
    handler: async (args): Promise<ToolResult> => {
      const state = store.getState();
      if (!state.source) return { ok: false, error: 'no_video_loaded' };
      if (state.source.kind === 'youtube') {
        return { ok: false, error: 'transcribe_unavailable_on_youtube', hint: 'Needs direct audio access; not available for a YouTube source.' };
      }

      const timeCtx = { currentTime: state.player.currentTime, duration: state.player.duration, fps: state.player.fps };
      const from = args.from !== undefined ? parseTime(args.from, timeCtx) : 0;
      const to = args.to !== undefined ? parseTime(args.to, timeCtx) : state.player.duration;
      if (from === null || to === null) return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };
      if (to <= from) return { ok: false, error: 'invalid_range', hint: '`to` must be after `from`.' };

      const modelId = TIER_TO_MODEL_ID[args.model ?? 'tiny'];
      const ensured = await mlClient.ensureModel(modelId, {
        confirmDownload: args.confirmDownload,
        onProgress: (fraction) => store.getState().setModelState(modelId, { progress: fraction }),
      });
      if (!ensured.ok) {
        if (ensured.error === 'unknown_model') return { ok: false, error: 'unknown_model', hint: `no model with id "${modelId}"` };
        return { ok: false, error: ensured.error, hint: ensured.hint };
      }
      store.getState().setModelState(modelId, { loaded: true, cached: true, progress: 1 });

      let samples: Float32Array;
      try {
        const extracted = await extractAudioPcm(state.source, { start: from, end: to });
        samples = extracted.samples;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith('no_audio_track')) return { ok: false, error: 'no_audio_track', hint: 'This source has no audio track to transcribe.' };
        throw error;
      }

      const { segments: relativeSegments } = await ensured.worker.call<WorkerTranscribeResult>('transcribe', { samples, language: args.language });
      // The worker only ever sees the trimmed [from,to) clip, so its segment timestamps are
      // relative to that clip's own start -- shift back to the video's absolute timeline.
      const segments: TranscriptSegment[] = relativeSegments.map((s) => ({
        start: s.start + from,
        end: s.end + from,
        text: s.text,
        words: s.words?.map((w) => ({ start: w.start + from, end: w.end + from, text: w.text })),
      }));

      const merged = mergeSegments(state.transcript.segments, from, to, segments);
      store.getState().setTranscript(merged, null);
      if (state.source.assetId) await persistTranscript(state.source.assetId, null, merged);

      return {
        ok: true,
        summary: `Transcribed ${secsToTimecode(from)}-${secsToTimecode(to)}: ${segments.length} segment(s)`,
        segments,
      };
    },
  });

  registry.define<GetTranscriptArgs>({
    name: 'get_transcript',
    description: 'Returns the transcript (optionally trimmed to a time range) as segments, plain text, SRT, or VTT.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: ['string', 'number'] },
        to: { type: ['string', 'number'] },
        format: { type: 'string', enum: ['text', 'segments', 'srt', 'vtt'] },
        lang: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: true },
    group: 'transcript',
    when: 'after-transcribe',
    handler: async (args): Promise<ToolResult> => {
      const state = store.getState();
      const lang = args.lang ?? null;
      const segments =
        lang === state.transcript.lang || !state.source?.assetId ? state.transcript.segments : ((await getPersistedTranscript(state.source.assetId, lang)) ?? []);
      if (segments.length === 0) return { ok: false, error: 'no_transcript', hint: lang ? `no transcript for lang "${lang}" yet` : 'call transcribe first' };

      const timeCtx = { currentTime: state.player.currentTime, duration: state.player.duration, fps: state.player.fps };
      const from = args.from !== undefined ? parseTime(args.from, timeCtx) : -Infinity;
      const to = args.to !== undefined ? parseTime(args.to, timeCtx) : Infinity;
      if (from === null || to === null) return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };
      const filtered = segments.filter((s) => overlaps(s.start, s.end, from, to));

      const format = args.format ?? 'segments';
      if (format === 'segments') {
        return { ok: true, summary: `${filtered.length} segment(s)`, segments: filtered };
      }
      if (format === 'srt') {
        return { ok: true, summary: `${filtered.length} segment(s) as SRT`, text: buildSrtString(filtered) };
      }
      if (format === 'vtt') {
        return { ok: true, summary: `${filtered.length} segment(s) as VTT`, text: buildVttString(filtered) };
      }
      return { ok: true, summary: `${filtered.length} segment(s) as text`, text: filtered.map((s) => s.text).join(' ') };
    },
  });

  registry.define<SearchTranscriptArgs>({
    name: 'search_transcript',
    description: 'Case-insensitive substring search over the transcript, returning each hit with its timestamp and neighboring segments for context.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, lang: { type: 'string' } }, required: ['query'] },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    group: 'transcript',
    when: 'after-transcribe',
    handler: async (args): Promise<ToolResult> => {
      const state = store.getState();
      const lang = args.lang ?? null;
      const segments =
        lang === state.transcript.lang || !state.source?.assetId ? state.transcript.segments : ((await getPersistedTranscript(state.source.assetId, lang)) ?? []);
      if (segments.length === 0) return { ok: false, error: 'no_transcript', hint: lang ? `no transcript for lang "${lang}" yet` : 'call transcribe first' };
      if (!args.query.trim()) return { ok: false, error: 'invalid_query', hint: '`query` must not be empty' };

      const needle = args.query.toLowerCase();
      const hits = segments
        .map((segment, index) => ({ segment, index }))
        .filter(({ segment }) => segment.text.toLowerCase().includes(needle))
        .map(({ segment, index }) => ({
          start: segment.start,
          end: segment.end,
          text: segment.text,
          contextBefore: segments[index - 1]?.text,
          contextAfter: segments[index + 1]?.text,
        }));

      return { ok: true, summary: `${hits.length} hit(s) for "${args.query}"`, hits };
    },
  });
}
