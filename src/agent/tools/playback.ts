import { parseTime } from '../../lib/time';
import { secsToTimecode } from '../../lib/time';
import type { StudioStore } from '../../store/studio';
import type { Registry, ToolResult } from '../registry';

function playbackSummary(store: StudioStore): string {
  const p = store.getState().player;
  return `Playhead at ${secsToTimecode(p.currentTime)}, ${p.paused ? 'paused' : 'playing'}`;
}

/** playback tools: play/pause/toggle_play, seek, step_frames (local), set_playback. */
export function definePlaybackTools(registry: Registry, store: StudioStore): void {
  registry.define({
    name: 'play',
    description: 'Starts (or resumes) playback.',
    inputSchema: { type: 'object', properties: {} },
    group: 'playback',
    when: 'always',
    handler: async (): Promise<ToolResult> => {
      await store.getState().play();
      return { ok: true, summary: playbackSummary(store) };
    },
  });

  registry.define({
    name: 'pause',
    description: 'Pauses playback.',
    inputSchema: { type: 'object', properties: {} },
    group: 'playback',
    when: 'always',
    handler: (): ToolResult => {
      store.getState().pause();
      return { ok: true, summary: playbackSummary(store) };
    },
  });

  registry.define({
    name: 'toggle_play',
    description: 'Plays if paused, pauses if playing.',
    inputSchema: { type: 'object', properties: {} },
    group: 'playback',
    when: 'always',
    handler: async (): Promise<ToolResult> => {
      await store.getState().togglePlay();
      return { ok: true, summary: playbackSummary(store) };
    },
  });

  registry.define<{ time: string | number }>({
    name: 'seek',
    description: 'Moves the playhead. Accepts seconds (12.5), a timecode ("1:23.400"), a relative offset ("+5", "-2"), a percent of duration ("50%"), or a frame ("f30").',
    inputSchema: { type: 'object', properties: { time: { type: ['string', 'number'] } }, required: ['time'] },
    group: 'playback',
    when: 'always',
    handler: async (args): Promise<ToolResult> => {
      const { currentTime, duration, fps } = store.getState().player;
      const target = parseTime(args.time, { currentTime, duration, fps });
      if (target === null) {
        return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };
      }
      await store.getState().seek(target);
      return { ok: true, summary: playbackSummary(store) };
    },
  });

  registry.define<{ count: number }>({
    name: 'step_frames',
    description: 'Steps the playhead by an exact number of frames (negative steps backward). Intended for use while paused.',
    inputSchema: { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'] },
    group: 'playback',
    when: 'local',
    handler: async (args): Promise<ToolResult> => {
      await store.getState().stepFrames(args.count);
      return { ok: true, summary: playbackSummary(store) };
    },
  });

  registry.define<{ volume?: number; muted?: boolean; rate?: number; loop?: { start: number; end: number } | null }>({
    name: 'set_playback',
    description: 'Sets volume, mute, playback rate, and/or an in-page A/B loop.',
    inputSchema: {
      type: 'object',
      properties: {
        volume: { type: 'number', minimum: 0, maximum: 1 },
        muted: { type: 'boolean' },
        rate: { type: 'number', minimum: 0.25, maximum: 4 },
        loop: {
          type: ['object', 'null'],
          properties: { start: { type: 'number' }, end: { type: 'number' } },
          required: ['start', 'end'],
        },
      },
    },
    group: 'playback',
    when: 'always',
    handler: (args): ToolResult => {
      const state = store.getState();
      if (args.volume !== undefined) state.setPlayerVolume(args.volume);
      if (args.muted !== undefined) state.setPlayerMuted(args.muted);
      if (args.rate !== undefined) state.setPlayerRate(args.rate);
      if (args.loop !== undefined) state.setLoop(args.loop);
      const p = store.getState().player;
      return { ok: true, summary: `volume=${p.volume} muted=${p.muted} rate=${p.rate}x${p.loop ? ` loop=[${p.loop.start},${p.loop.end}]` : ''}` };
    },
  });
}
