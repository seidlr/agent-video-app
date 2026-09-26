import { describe, expect, it } from 'vitest';
import { createCommandBus, longPollCommands } from '../../server/bus';

// Real, tiny durations (not fake timers) -- exercises the exact same setTimeout-based race in
// dispatch() that production uses (15s/25s/10min), just fast enough for a test suite.
const FAST_OPTS = { connectedWindowMs: 40, dispatchTimeoutMs: 60, resultTtlMs: 200 };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('command bus (Task 11)', () => {
  it('delivers a dispatched command once to the active instance only', async () => {
    const bus = createCommandBus(FAST_OPTS);
    bus.registerInstance('s1', 'inst-a');

    const dispatchPromise = bus.dispatch('s1', { name: 'seek', args: { time: 5 } });
    // Poll for the command as the active instance -- it should appear exactly once.
    const first = bus.pollCommands('s1', 'inst-a');
    expect(first).toMatchObject({ command: { name: 'seek', args: { time: 5 } } });
    const second = bus.pollCommands('s1', 'inst-a');
    expect(second).toMatchObject({ command: null });

    const cmdId = (first as { command: { cmdId: string } }).command.cmdId;
    bus.postResult('s1', 'inst-a', cmdId, { ok: true, summary: 'seeked' });
    const result = await dispatchPromise;
    expect(result).toMatchObject({ ok: true, summary: 'seeked', instanceId: 'inst-a' });
  });

  it('a second instance becoming active retires the first, whose poll now returns retired', () => {
    const bus = createCommandBus(FAST_OPTS);
    bus.registerInstance('s1', 'inst-a');
    bus.registerInstance('s1', 'inst-b');

    expect(bus.pollCommands('s1', 'inst-a')).toEqual({ retired: true });
    expect(bus.pollCommands('s1', 'inst-b')).toMatchObject({ command: null });
  });

  it('no active instance poll within the connected window returns ui_not_connected immediately', async () => {
    const bus = createCommandBus(FAST_OPTS);
    bus.registerInstance('s1', 'inst-a');
    await sleep(FAST_OPTS.connectedWindowMs + 10);

    const result = await bus.dispatch('s1', { name: 'seek', args: {} });
    expect(result).toEqual({ ok: false, error: 'ui_not_connected', hint: expect.any(String) });
  });

  // A host that can't render MCP Apps (e.g. a Claude Code session) still calls open_video_studio:
  // the instance is registered but no UI ever mounts to poll it.
  describe('an opened instance that never connects', () => {
    const UI_URL = 'https://example.test/studio/?bus=http://localhost:3333';
    const opts = { ...FAST_OPTS, firstPollGraceMs: 20, uiFallbackUrl: UI_URL };

    it('fails fast with ui_not_connected naming the fallback URL, instead of queuing a job that never finishes', async () => {
      const bus = createCommandBus(opts);
      bus.registerInstance('s1', 'inst-a');

      const result = await bus.dispatch('s1', { name: 'get_state', args: {} });
      expect(result).toEqual({ ok: false, error: 'ui_not_connected', hint: expect.stringContaining(UI_URL), uiUrl: UI_URL });
      // Nothing is left queued for a UI that might attach later and replay stale commands.
      expect(bus.pollCommands('s1', 'inst-a')).toMatchObject({ command: null });
    });

    it('still delivers a command sent before the first poll when the UI connects within the grace window', async () => {
      const bus = createCommandBus(opts);
      bus.registerInstance('s1', 'inst-a');

      const dispatchPromise = bus.dispatch('s1', { name: 'seek', args: { time: 5 } });
      await sleep(8); // an MCP App iframe mounting a moment after open_video_studio returned
      const polled = bus.pollCommands('s1', 'inst-a');
      const cmdId = (polled as { command: { cmdId: string } }).command.cmdId;
      bus.postResult('s1', 'inst-a', cmdId, { ok: true, summary: 'seeked' });

      expect(await dispatchPromise).toMatchObject({ ok: true, summary: 'seeked' });
    });

    // Found live in a Claude chat: the page from uiUrl was open and working, then the agent called
    // open_video_studio again -- registering a view that never rendered -- and that retired the
    // live tab, so every later call waited out the grace and failed.
    it('does not strand a live tab: commands keep going to it until the new instance actually polls', async () => {
      const bus = createCommandBus(opts);
      bus.registerInstance('s1', 'tab');
      bus.pollCommands('s1', 'tab');
      bus.registerInstance('s1', 'never-rendered');

      const started = Date.now();
      const dispatchPromise = bus.dispatch('s1', { name: 'seek', args: { time: 5 } });
      const polled = bus.pollCommands('s1', 'tab');
      expect(polled).toMatchObject({ command: { name: 'seek' } });
      bus.postResult('s1', 'tab', (polled as { command: { cmdId: string } }).command.cmdId, { ok: true, summary: 'seeked' });
      expect(await dispatchPromise).toMatchObject({ ok: true, summary: 'seeked', instanceId: 'tab' });
      expect(Date.now() - started).toBeLessThan(opts.firstPollGraceMs);
    });

    it('a newly opened instance takes over once it polls', async () => {
      const bus = createCommandBus(opts);
      bus.registerInstance('s1', 'tab');
      bus.pollCommands('s1', 'tab');
      bus.registerInstance('s1', 'app');
      expect(bus.pollCommands('s1', 'app')).toMatchObject({ command: null });

      const dispatchPromise = bus.dispatch('s1', { name: 'seek', args: {} });
      expect(bus.pollCommands('s1', 'tab')).toEqual({ retired: true });
      const polled = bus.pollCommands('s1', 'app');
      bus.postResult('s1', 'app', (polled as { command: { cmdId: string } }).command.cmdId, { ok: true, summary: 'seeked' });
      expect(await dispatchPromise).toMatchObject({ ok: true, instanceId: 'app' });
    });

    it('a UI that went quiet also gets the fallback URL in its ui_not_connected hint', async () => {
      const bus = createCommandBus(opts);
      bus.registerInstance('s1', 'inst-a');
      bus.pollCommands('s1', 'inst-a');
      await sleep(FAST_OPTS.connectedWindowMs + 10);

      const result = await bus.dispatch('s1', { name: 'seek', args: {} });
      expect(result).toMatchObject({ ok: false, error: 'ui_not_connected', uiUrl: UI_URL, hint: expect.stringContaining(UI_URL) });
    });
  });

  it('a slow result returns {jobId, status:"running"} first, then get_job returns the late result', async () => {
    const bus = createCommandBus(FAST_OPTS);
    bus.registerInstance('s1', 'inst-a');

    const dispatchPromise = bus.dispatch('s1', { name: 'transcribe', args: {} });
    const polled = bus.pollCommands('s1', 'inst-a');
    const cmdId = (polled as { command: { cmdId: string } }).command.cmdId;

    const running = await dispatchPromise;
    expect(running).toEqual({ ok: true, jobId: cmdId, status: 'running' });

    // Result arrives after dispatch() already gave up and returned "running".
    bus.postResult('s1', 'inst-a', cmdId, { ok: true, summary: 'done transcribing' });
    const job = bus.getJob('s1', cmdId);
    expect(job).toMatchObject({ ok: true, status: 'done', result: { ok: true, summary: 'done transcribing' } });
  });

  it('the same requestId dispatched twice returns the same cmdId instead of dispatching again', async () => {
    const bus = createCommandBus(FAST_OPTS);
    bus.registerInstance('s1', 'inst-a');

    const first = bus.dispatch('s1', { name: 'seek', args: { time: 1 }, requestId: 'req-1' });
    const polled = bus.pollCommands('s1', 'inst-a');
    const cmdId = (polled as { command: { cmdId: string } }).command.cmdId;

    // A retry with the same requestId, issued before the first has resolved, must not create a
    // second pending command (a second poll would otherwise see a second entry).
    const second = bus.dispatch('s1', { name: 'seek', args: { time: 1 }, requestId: 'req-1' });
    expect(bus.pollCommands('s1', 'inst-a')).toEqual({ command: null });

    bus.postResult('s1', 'inst-a', cmdId, { ok: true, summary: 'seeked' });
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toMatchObject({ ok: true, summary: 'seeked' });
    expect(secondResult).toEqual({ ok: true, jobId: cmdId, status: 'running' });
  });

  it('an expectedAssetId mismatch returns instance_asset_changed without dispatching', async () => {
    const bus = createCommandBus(FAST_OPTS);
    bus.registerInstance('s1', 'inst-a', 'asset-1');

    const result = await bus.dispatch('s1', { name: 'seek', args: {}, expectedAssetId: 'asset-2' });
    expect(result).toEqual({ ok: false, error: 'instance_asset_changed', instanceId: 'inst-a', asset: 'asset-1' });
    expect(bus.pollCommands('s1', 'inst-a')).toEqual({ command: null });
  });

  it('activate_instance reactivates a previously retired instance', () => {
    const bus = createCommandBus(FAST_OPTS);
    bus.registerInstance('s1', 'inst-a');
    bus.registerInstance('s1', 'inst-b');
    expect(bus.pollCommands('s1', 'inst-a')).toEqual({ retired: true });

    bus.activateInstance('s1', 'inst-a');
    expect(bus.pollCommands('s1', 'inst-a')).toMatchObject({ command: null });
    expect(bus.pollCommands('s1', 'inst-b')).toEqual({ retired: true });
  });

  it('getJob reports unknown_job for a cmdId it has never seen', () => {
    const bus = createCommandBus(FAST_OPTS);
    expect(bus.getJob('s1', 'no-such-cmd')).toEqual({ ok: false, error: 'unknown_job', hint: expect.any(String) });
  });

  it('a stored result expires after resultTtlMs and getJob reports unknown_job again', async () => {
    const bus = createCommandBus(FAST_OPTS);
    bus.registerInstance('s1', 'inst-a');
    const dispatchPromise = bus.dispatch('s1', { name: 'seek', args: {} });
    const polled = bus.pollCommands('s1', 'inst-a');
    const cmdId = (polled as { command: { cmdId: string } }).command.cmdId;
    bus.postResult('s1', 'inst-a', cmdId, { ok: true, summary: 'seeked' });
    await dispatchPromise;

    expect(bus.getJob('s1', cmdId)).toMatchObject({ ok: true, status: 'done' });
    await sleep(FAST_OPTS.resultTtlMs + 20);
    expect(bus.getJob('s1', cmdId)).toMatchObject({ ok: false, error: 'unknown_job' });
  });

  it('an image posted alongside a result is carried on the resolved dispatch value and on a later getJob', async () => {
    const bus = createCommandBus(FAST_OPTS);
    bus.registerInstance('s1', 'inst-a');
    const dispatchPromise = bus.dispatch('s1', { name: 'capture_frame', args: {} });
    const polled = bus.pollCommands('s1', 'inst-a');
    const cmdId = (polled as { command: { cmdId: string } }).command.cmdId;

    bus.postResult('s1', 'inst-a', cmdId, { ok: true, summary: 'captured' }, { base64: 'ZmFrZS1wbmc=', mimeType: 'image/png' });
    const resolved = await dispatchPromise;
    expect(resolved).toMatchObject({ ok: true, summary: 'captured', image: { base64: 'ZmFrZS1wbmc=', mimeType: 'image/png' } });

    const job = bus.getJob('s1', cmdId);
    expect(job.result).toMatchObject({ image: { base64: 'ZmFrZS1wbmc=', mimeType: 'image/png' } });
  });

  describe('longPollCommands (shared by poll_commands and /bus/poll)', () => {
    it('returns as soon as a command is dispatched, without waiting for the full timeout', async () => {
      const bus = createCommandBus(FAST_OPTS);
      bus.registerInstance('s1', 'inst-a');
      void bus.dispatch('s1', { name: 'seek', args: {} });

      const started = Date.now();
      const polled = await longPollCommands(bus, 's1', 'inst-a', 5000, 20);
      expect(Date.now() - started).toBeLessThan(200);
      expect(polled).toMatchObject({ command: { name: 'seek' } });
    });

    it('returns {command:null} after the timeout when nothing is ever dispatched', async () => {
      const bus = createCommandBus(FAST_OPTS);
      bus.registerInstance('s1', 'inst-a');
      const polled = await longPollCommands(bus, 's1', 'inst-a', 60, 20);
      expect(polled).toEqual({ command: null });
    });

    it('returns {retired:true} immediately for an instance that is not the active one', async () => {
      const bus = createCommandBus(FAST_OPTS);
      bus.registerInstance('s1', 'inst-a');
      bus.registerInstance('s1', 'inst-b'); // retires inst-a

      const started = Date.now();
      const polled = await longPollCommands(bus, 's1', 'inst-a', 5000, 20);
      expect(Date.now() - started).toBeLessThan(200);
      expect(polled).toEqual({ retired: true });
    });
  });
});
