import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const opfsMock = vi.hoisted(() => ({
  writeFile: vi.fn(async () => undefined),
  readFile: vi.fn(async () => new File([new Uint8Array(4)], 'internal-name.mp4', { type: 'video/mp4' })),
  deleteFile: vi.fn(async () => undefined),
}));
vi.mock('../../src/store/opfs', () => opfsMock);

// Real isMcpAppContext() reads window.location, unavailable under this file's Node environment --
// mocked so a test can force the MCP-App branch of load_video's own library-source check
// (Task 11) without needing a real (or jsdom-simulated) browser global.
const mcpAppMock = vi.hoisted(() => ({ isMcpAppContext: vi.fn(() => false) }));
vi.mock('../../src/agent/mcpApp', () => mcpAppMock);

import { db } from '../../src/store/db';
import { DEFAULT_PROJECT_ID } from '../../src/lib/types';
import { importFile } from '../../src/store/library';
import { createRegistry } from '../../src/agent/registry';
import { defineSessionTools } from '../../src/agent/tools/session';
import { defineLibraryTools } from '../../src/agent/tools/library';
import { definePlaybackTools } from '../../src/agent/tools/playback';
import { createStudioStore, type PlayerHandle } from '../../src/store/studio';

const SAMPLES_RESPONSE = {
  samples: [{ id: 'sprite-fight', title: 'Sprite Fight', url: 'https://files.vidstack.io/sprite-fight/720p.mp4', duration: 629, width: 1280, height: 720, license: 'demo' }],
};

function createMockPlayer(overrides: Partial<PlayerHandle> = {}): PlayerHandle & { emit(type: string): void } {
  const listeners = new Map<string, Set<() => void>>();
  const handle: PlayerHandle & { emit(type: string): void } = {
    currentTime: 0,
    volume: 1,
    muted: false,
    playbackRate: 1,
    paused: true,
    play: vi.fn(async () => {
      handle.paused = false;
    }),
    pause: vi.fn(() => {
      handle.paused = true;
    }),
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    emit(type) {
      for (const l of listeners.get(type) ?? []) l();
    },
    ...overrides,
  };
  return handle;
}

function setupRegistry() {
  const activity: unknown[] = [];
  const store = createStudioStore();
  const registry = createRegistry({
    pushActivity: (call) => activity.push(call),
    updateActivity: () => undefined,
  });
  defineSessionTools(registry, store);
  defineLibraryTools(registry, store);
  definePlaybackTools(registry, store);
  return { registry, store, activity };
}

describe('session/library/playback tools', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(SAMPLES_RESPONSE), { status: 200 })),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await db.assets.clear();
    await db.projects.clear();
  });

  describe('session', () => {
    it('get_state reports no video loaded and a hint before anything is loaded', async () => {
      const { registry } = setupRegistry();
      const result = await registry.call('get_state', {});
      expect(result).toMatchObject({ ok: true, source: null, summary: 'No video loaded' });
      expect((result as unknown as { hints: string[] }).hints[0]).toMatch(/No video loaded/);
    });

    it('get_state reports the loaded source, player and counts once a video and a note exist', async () => {
      const { registry, store } = setupRegistry();
      store.getState().setSource({ src: 'https://x/v.mp4', title: 'Clip', kind: 'url', canCapture: true });
      store.getState().setDuration(100);
      store.getState().addNote({ time: 1, text: 'hi', tags: [], createdBy: 'agent' });

      const result = await registry.call('get_state', {});
      expect(result).toMatchObject({
        ok: true,
        source: { kind: 'url', title: 'Clip' },
        player: { duration: 100, paused: true },
        counts: { notes: 1 },
      });
    });

    it('get_agent_skill returns non-empty content', async () => {
      const { registry } = setupRegistry();
      const result = await registry.call('get_agent_skill', {});
      expect(result).toMatchObject({ ok: true });
      expect((result as unknown as { content: string }).content.length).toBeGreaterThan(0);
    });

    it('get_agent_skill strips the SKILL.md frontmatter block from the returned content', async () => {
      const { registry } = setupRegistry();
      const result = (await registry.call('get_agent_skill', {})) as unknown as { content: string };
      expect(result.content.startsWith('---')).toBe(false);
      expect(result.content).not.toContain('\nname: agent-video-studio\n');
    });

    it('get_agent_skill {section} returns just the matching heading\'s content', async () => {
      const { registry } = setupRegistry();
      const result = (await registry.call('get_agent_skill', { section: 'workflows' })) as unknown as { ok: true; content: string; summary: string };
      expect(result.ok).toBe(true);
      expect(result.content.startsWith('## ')).toBe(true);
      expect(result.content.toLowerCase()).toContain('workflow');
      expect(result.summary.toLowerCase()).toContain('workflow');
    });

    it('get_agent_skill {section} is case-insensitive and matches on substring', async () => {
      const { registry } = setupRegistry();
      const result = (await registry.call('get_agent_skill', { section: 'Workflows' })) as unknown as { content: string };
      const lower = (await registry.call('get_agent_skill', { section: 'workflow' })) as unknown as { content: string };
      expect(result.content).toBe(lower.content);
    });

    it('get_agent_skill {section} reports ok:false with known sections listed for a non-matching section', async () => {
      const { registry } = setupRegistry();
      const result = await registry.call('get_agent_skill', { section: 'no-such-heading-xyz' });
      expect(result).toMatchObject({ ok: false, error: 'unknown_section' });
      expect((result as unknown as { hint: string }).hint).toContain('no-such-heading-xyz');
    });

    it('get_job/list_jobs/cancel_job wire through to registry.jobs', async () => {
      const { registry } = setupRegistry();
      const { jobId } = registry.jobs.start({
        tool: 'x',
        run: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, summary: 'done' }), 200)),
      });

      const listed = await registry.call('list_jobs', {});
      expect((listed as unknown as { jobs: { jobId: string }[] }).jobs.map((j) => j.jobId)).toContain(jobId);

      const got = await registry.call('get_job', { jobId });
      expect(got).toMatchObject({ ok: true, jobId });

      const cancelled = await registry.call('cancel_job', { jobId });
      expect(cancelled).toMatchObject({ ok: true });

      const cancelAgain = await registry.call('cancel_job', { jobId });
      expect(cancelAgain).toMatchObject({ ok: false, error: 'cannot_cancel' });
    });

    it('get_job returns ok:false for an unknown jobId', async () => {
      const { registry } = setupRegistry();
      const result = await registry.call('get_job', { jobId: 'nope' });
      expect(result).toMatchObject({ ok: false, error: 'unknown_job' });
    });

    it('say echoes the message back and set_view switches the panel', async () => {
      const { registry, store } = setupRegistry();
      const said = await registry.call('say', { message: 'hello there' });
      expect(said).toMatchObject({ ok: true, summary: 'hello there' });

      const viewed = await registry.call('set_view', { panel: 'notes' });
      expect(viewed).toMatchObject({ ok: true });
      expect(store.getState().ui.panel).toBe('notes');
    });

    it('set_view rejects a call with neither panel nor layout', async () => {
      const { registry } = setupRegistry();
      const result = await registry.call('set_view', {});
      expect(result).toMatchObject({ ok: false, error: 'missing_args' });
    });
  });

  describe('library', () => {
    it('list_library reports the sample catalog and stored assets', async () => {
      const { registry } = setupRegistry();
      await importFile(new File([new Uint8Array(8)], 'clip.mp4', { type: 'video/mp4' }), DEFAULT_PROJECT_ID);

      const result = await registry.call('list_library', {});
      expect(result).toMatchObject({ ok: true });
      expect((result as unknown as { samples: { id: string }[] }).samples.map((s) => s.id)).toContain('sprite-fight');
      expect((result as unknown as { library: { name: string }[] }).library.map((a) => a.name)).toContain('clip.mp4');
    });

    it('load_video maps source:"library" to a file-kind load and sets the store source', async () => {
      const { registry, store } = setupRegistry();
      const asset = await importFile(new File([new Uint8Array(8)], 'clip.mp4', { type: 'video/mp4' }), DEFAULT_PROJECT_ID);

      const result = await registry.call('load_video', { source: 'library', id: asset.id });
      expect(result).toMatchObject({ ok: true, source: { kind: 'file' } });
      expect(store.getState().source?.assetId).toBe(asset.id);
    });

    it('load_video loads a sample by id', async () => {
      const { registry, store } = setupRegistry();
      const result = await registry.call('load_video', { source: 'sample', id: 'sprite-fight' });
      expect(result).toMatchObject({ ok: true, source: { kind: 'sample', title: 'Sprite Fight' } });
      expect(store.getState().source?.kind).toBe('sample');
    });

    it('load_video rejects an unknown source enum value before touching the store', async () => {
      const { registry, store } = setupRegistry();
      const result = await registry.call('load_video', { source: 'not-a-real-source' });
      expect(result).toMatchObject({ ok: false, error: 'invalid_args' }); // caught by inputSchema enum, not our own check
      expect(store.getState().source).toBeNull();
    });

    it('load_video reports load_failed for a library id that does not exist', async () => {
      const { registry } = setupRegistry();
      const result = await registry.call('load_video', { source: 'library', id: 'missing' });
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining('load_failed') });
    });

    it('load_video rejects source:"library" inside an MCP App with a dedicated hint, without ever touching the store (Task 11)', async () => {
      mcpAppMock.isMcpAppContext.mockReturnValue(true);
      try {
        const { registry, store } = setupRegistry();
        const asset = await importFile(new File([new Uint8Array(8)], 'clip.mp4', { type: 'video/mp4' }), DEFAULT_PROJECT_ID);
        const result = await registry.call('load_video', { source: 'library', id: asset.id });
        expect(result).toEqual({ ok: false, error: 'library_unavailable_in_mcp_app', hint: expect.stringContaining('sample') });
        expect(store.getState().source).toBeNull();
      } finally {
        mcpAppMock.isMcpAppContext.mockReturnValue(false);
      }
    });

    it('load_video still loads a sample by id inside an MCP App -- only source:"library" is restricted (Task 11)', async () => {
      mcpAppMock.isMcpAppContext.mockReturnValue(true);
      try {
        const { registry, store } = setupRegistry();
        const result = await registry.call('load_video', { source: 'sample', id: 'sprite-fight' });
        expect(result).toMatchObject({ ok: true, source: { kind: 'sample' } });
        expect(store.getState().source?.kind).toBe('sample');
      } finally {
        mcpAppMock.isMcpAppContext.mockReturnValue(false);
      }
    });

    it('remove_video deletes the asset', async () => {
      const { registry } = setupRegistry();
      const asset = await importFile(new File([new Uint8Array(8)], 'clip.mp4', { type: 'video/mp4' }), DEFAULT_PROJECT_ID);

      const result = await registry.call('remove_video', { id: asset.id });
      expect(result).toMatchObject({ ok: true });
      expect(await db.assets.get(asset.id)).toBeUndefined();
    });

    it('request_file_upload switches to the library panel', async () => {
      const { registry, store } = setupRegistry();
      const result = await registry.call('request_file_upload', {});
      expect(result).toMatchObject({ ok: true });
      expect(store.getState().ui.panel).toBe('library');
    });
  });

  describe('playback', () => {
    it('play/pause/toggle_play delegate to the registered player handle', async () => {
      const { registry, store } = setupRegistry();
      const handle = createMockPlayer();
      store.getState().registerPlayer(handle);

      await registry.call('play', {});
      expect(handle.play).toHaveBeenCalledTimes(1);

      await registry.call('pause', {});
      expect(handle.pause).toHaveBeenCalledTimes(1);
    });

    it('seek accepts a relative offset and resolves the store snapshot', async () => {
      const { registry, store } = setupRegistry();
      const handle = createMockPlayer();
      store.getState().registerPlayer(handle);
      store.getState().setCurrentTime(10);

      const callPromise = registry.call('seek', { time: '+5' });
      handle.emit('seeked');
      const result = await callPromise;

      expect(handle.currentTime).toBe(15);
      expect(result).toMatchObject({ ok: true });
    });

    it('seek rejects an unparseable time', async () => {
      const { registry } = setupRegistry();
      const result = await registry.call('seek', { time: 'not-a-time' });
      expect(result).toMatchObject({ ok: false, error: 'invalid_time' });
    });

    it('step_frames steps by count/fps seconds', async () => {
      const { registry, store } = setupRegistry();
      const handle = createMockPlayer();
      store.getState().registerPlayer(handle);
      store.getState().setFps(30);
      store.getState().setCurrentTime(1);

      const callPromise = registry.call('step_frames', { count: 3 });
      handle.emit('seeked');
      await callPromise;

      expect(handle.currentTime).toBeCloseTo(1.1);
    });

    it('set_playback applies volume/muted/rate and reports them', async () => {
      const { registry, store } = setupRegistry();
      const handle = createMockPlayer();
      store.getState().registerPlayer(handle);

      const result = await registry.call('set_playback', { volume: 0.3, muted: true, rate: 1.5 });
      expect(result).toMatchObject({ ok: true, summary: expect.stringContaining('volume=0.3') });
      expect(handle.volume).toBe(0.3);
      expect(handle.muted).toBe(true);
      expect(handle.playbackRate).toBe(1.5);
    });

    it('set_playback sets and clears a loop', async () => {
      const { registry, store } = setupRegistry();
      await registry.call('set_playback', { loop: { start: 2, end: 8 } });
      expect(store.getState().player.loop).toEqual({ start: 2, end: 8 });

      await registry.call('set_playback', { loop: null });
      expect(store.getState().player.loop).toBeNull();
    });

    it('set_playback rejects volume outside [0,1]', async () => {
      const { registry } = setupRegistry();
      const result = await registry.call('set_playback', { volume: 1.5 });
      expect(result).toMatchObject({ ok: false, error: 'invalid_args' });
    });
  });
});
