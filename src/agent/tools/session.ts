import { secsToTimecode } from '../../lib/time';
import type { PanelId, StudioStore, ThemeSetting, UiState } from '../../store/studio';
import type { Registry, ToolResult } from '../registry';

const VIEW_PANELS: PanelId[] = ['library', 'notes', 'frames', 'tracking', 'vision', 'transcript', 'clips', 'effects', 'models', 'activity', 'skill'];

/**
 * session tools: get_state, get_agent_skill, get_job/list_jobs/cancel_job, say, set_view.
 * Everything here is `always` -- it does not depend on a video being loaded.
 */
export function defineSessionTools(registry: Registry, store: StudioStore): void {
  registry.define({
    name: 'get_state',
    description: 'Reports the full current studio state: the loaded source, player transport, item counts, capabilities, and hints for what to do next. Call this first.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    group: 'session',
    when: 'always',
    handler: (): ToolResult => {
      const s = store.getState();
      const hints: string[] = [];
      if (!s.source) hints.push('No video loaded. Call load_video with a sample id, a URL, a YouTube link, or request_file_upload for a local file.');
      if (s.source && !s.storage.persisted) hints.push('Storage is not persisted; the browser may evict this video if the tab goes unused for a while.');

      const summary = s.source
        ? `${s.source.title} · ${secsToTimecode(s.player.currentTime)} / ${secsToTimecode(s.player.duration)} · ${s.player.paused ? 'paused' : 'playing'} · ${s.notes.length} note(s)`
        : 'No video loaded';

      return {
        ok: true,
        summary,
        source: s.source ? { kind: s.source.kind, title: s.source.title, src: s.source.src, assetId: s.source.assetId } : null,
        player: {
          currentTime: s.player.currentTime,
          duration: s.player.duration,
          paused: s.player.paused,
          volume: s.player.volume,
          muted: s.player.muted,
          rate: s.player.rate,
          fps: s.player.fps,
          width: s.player.width,
          height: s.player.height,
          frame: Math.round(s.player.currentTime * (s.player.fps || 30)),
          loop: s.player.loop,
        },
        counts: {
          frames: s.frames.length,
          boxes: s.boxes.length,
          tracks: s.tracks.length,
          notes: s.notes.length,
          chapters: s.chapters.length,
          clips: s.clips.length,
          transcriptSegments: s.transcript.segments.length,
        },
        capabilities: {
          canCapture: s.source?.canCapture ?? false,
          webgpu: s.capabilities.webgpu,
          webcodecs: s.capabilities.webcodecs,
          opfs: s.capabilities.opfs,
          tabCapture: s.capabilities.tabCapture,
        },
        transport: s.ui.agentTransport,
        // Populated once Task 7's model registry lands (list_models/load_model/unload_model).
        models: {},
        hints,
      };
    },
  });

  registry.define<{ section?: string }>({
    name: 'get_agent_skill',
    description: 'Returns the agent skill documentation describing how to use this app\'s tools.',
    inputSchema: { type: 'object', properties: { section: { type: 'string' } } },
    annotations: { readOnlyHint: true },
    group: 'session',
    when: 'always',
    // Task 10 replaces this with the real generated SKILL.md content (`?raw` import), sectioned
    // by `section`. Kept minimal here so the tool exists and is discoverable before then.
    handler: (): ToolResult => ({
      ok: true,
      summary: 'Agent Video Studio: an agent-first, front-end-only video player and editor.',
      content:
        'Call get_state first to see what is loaded. Use load_video to open a sample, a CORS-enabled URL, a YouTube link, or request_file_upload for a local file. Full documentation lands in a later task.',
    }),
  });

  registry.define<{ jobId: string }>({
    name: 'get_job',
    description: 'Reports the status, progress and (once finished) result of a background job started by a job-mode tool.',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
    annotations: { readOnlyHint: true },
    group: 'session',
    when: 'always',
    handler: (args): ToolResult => {
      const job = registry.jobs.get(args.jobId);
      if (!job) return { ok: false, error: 'unknown_job', hint: `no job with id "${args.jobId}"` };
      return {
        ok: true,
        summary: `${job.tool} is ${job.status}${job.status === 'running' ? ` (${Math.round(job.progress * 100)}%)` : ''}`,
        jobId: job.jobId,
        tool: job.tool,
        status: job.status,
        progress: job.progress,
        message: job.message,
        result: job.result,
      };
    },
  });

  registry.define({
    name: 'list_jobs',
    description: 'Lists every background job started this session, most recent last.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    group: 'session',
    when: 'always',
    handler: (): ToolResult => {
      const jobs = registry.jobs.list();
      return { ok: true, summary: `${jobs.length} job(s)`, jobs };
    },
  });

  registry.define<{ jobId: string }>({
    name: 'cancel_job',
    description: 'Cancels a running background job.',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
    group: 'session',
    when: 'always',
    handler: (args): ToolResult => {
      const cancelled = registry.jobs.cancel(args.jobId);
      if (!cancelled) {
        const job = registry.jobs.get(args.jobId);
        return { ok: false, error: 'cannot_cancel', hint: job ? `job is already ${job.status}` : `no job with id "${args.jobId}"` };
      }
      return { ok: true, summary: `Cancelled job ${args.jobId}` };
    },
  });

  registry.define<{ message: string }>({
    name: 'say',
    description: 'Posts a message from the agent into the Activity feed, visible to the human watching the page.',
    inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    group: 'session',
    when: 'always',
    handler: (args): ToolResult => ({ ok: true, summary: args.message, message: args.message }),
  });

  registry.define<{ panel?: string; layout?: string }>({
    name: 'set_view',
    description: 'Switches the right-rail panel and/or the overall layout.',
    inputSchema: {
      type: 'object',
      properties: {
        panel: { type: 'string', enum: VIEW_PANELS },
        layout: { type: 'string', enum: ['studio', 'focus'] },
      },
    },
    group: 'session',
    when: 'always',
    handler: (args): ToolResult => {
      if (!args.panel && !args.layout) {
        return { ok: false, error: 'missing_args', hint: 'Provide panel and/or layout.' };
      }
      const current = store.getState().ui;
      store.getState().setView((args.panel as PanelId | undefined) ?? current.panel, args.layout as UiState['layout'] | undefined);
      const next = store.getState().ui;
      return { ok: true, summary: `View: panel=${next.panel}, layout=${next.layout}` };
    },
  });
}

// Re-exported so tests/other modules can reference the exact enum without duplicating it.
export { VIEW_PANELS };
export type { ThemeSetting };
