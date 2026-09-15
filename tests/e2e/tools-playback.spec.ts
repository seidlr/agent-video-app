import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Drives the app exclusively through the WebMCP testing shim (`navigator.modelContextTesting`,
 * installed by `@mcp-b/global`'s polyfill) -- the same surface a real WebMCP-testing host uses,
 * and the plan's own required path for TS-001 ("proven by a Playwright script that drives
 * exclusively through navigator.modelContextTesting"). executeTool takes/returns JSON strings.
 *
 * Waits for `name` itself to actually appear in listTools() first: the shim object existing only
 * means @mcp-b/global's polyfill installed it, not that mountWebMcp()'s own registerTool() calls
 * (each async, run one at a time in registration order) have gotten around to this specific tool
 * yet. That gap is narrow enough to never lose locally but wide enough to fail reliably on a
 * slower CI runner (confirmed: CI failed calling `list_library` -- not the first tool
 * mountWebMcp() registers -- with "Tool not found" even after an earlier fix here that only
 * waited for a different, earlier-registered tool). Waiting for the exact tool about to be called
 * is the same discipline a real external agent should use before calling any tool, and covers
 * every call site automatically rather than requiring a hand-picked "readiness" tool per test.
 */
async function execTool(page: Page, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  await page.waitForFunction((toolName) => navigator.modelContextTesting?.listTools().some((t) => t.name === toolName) ?? false, name);
  const resultJson = await page.evaluate(
    async ({ name, argsJson }) => navigator.modelContextTesting!.executeTool(name, argsJson),
    { name, argsJson: JSON.stringify(args) },
  );
  return JSON.parse(resultJson ?? 'null') as Record<string, unknown>;
}

async function listToolNames(page: Page): Promise<string[]> {
  return page.evaluate(() => navigator.modelContextTesting!.listTools().map((t) => t.name).sort());
}

test.describe('agent tools (Task 4 DoD, TS-001)', () => {
  test('an external agent can load the sample, seek, play, and adjust playback using only navigator.modelContextTesting', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Step 1: empty state, no console errors.
    await page.goto('/');
    await expect(page.locator('header b')).toHaveText('no video loaded');

    // Step 2: list_library sees the sample catalog and no stored videos yet.
    const listed = await execTool(page, 'list_library');
    expect(listed).toMatchObject({ ok: true });
    expect((listed.samples as { id: string }[]).map((s) => s.id)).toContain('sprite-fight');
    expect(listed.library).toEqual([]);

    // Step 3: load_video loads the sample; get_state reflects it.
    const loaded = await execTool(page, 'load_video', { source: 'sample', id: 'sprite-fight' });
    expect(loaded).toMatchObject({ ok: true, source: { kind: 'sample', title: 'Sprite Fight' } });
    await expect(page.locator('header b')).toHaveText('Sprite Fight');

    // duration populates asynchronously once vidstack's player actually loads metadata for the
    // new source (captureMetadataOnce in VideoStage.tsx) -- load_video's own promise resolves as
    // soon as the source is set, before that has necessarily happened, so poll for it here.
    await expect
      .poll(async () => ((await execTool(page, 'get_state')).player as { duration: number }).duration, { timeout: 10_000 })
      .toBeGreaterThan(600);
    const stateAfterLoad = await execTool(page, 'get_state');
    expect(stateAfterLoad.source).toMatchObject({ kind: 'sample', title: 'Sprite Fight' });

    // Step 4: seek to a timecode; get_state confirms it landed within 0.1s.
    const sought = await execTool(page, 'seek', { time: '01:24' });
    expect(sought).toMatchObject({ ok: true });
    const stateAfterSeek = await execTool(page, 'get_state');
    expect((stateAfterSeek.player as { currentTime: number }).currentTime).toBeCloseTo(84, 0);

    // Step 5: play, wait ~1s, pause; currentTime advanced by roughly that much.
    const beforePlayTime = (stateAfterSeek.player as { currentTime: number }).currentTime;
    await execTool(page, 'play');
    await page.waitForTimeout(1000);
    await execTool(page, 'pause');
    const stateAfterPlay = await execTool(page, 'get_state');
    const afterPlayTime = (stateAfterPlay.player as { currentTime: number }).currentTime;
    expect(afterPlayTime - beforePlayTime).toBeGreaterThan(0.5);
    expect((stateAfterPlay.player as { paused: boolean }).paused).toBe(true);

    // Step 6: set_playback applies volume/muted/rate together.
    const playbackSet = await execTool(page, 'set_playback', { volume: 0.3, muted: true, rate: 1.5 });
    expect(playbackSet).toMatchObject({ ok: true });
    const stateAfterPlayback = await execTool(page, 'get_state');
    expect(stateAfterPlayback.player).toMatchObject({ volume: 0.3, muted: true, rate: 1.5 });

    // Step 7: the Activity feed logged every one of the six agent-action tool calls above
    // (list_library, load_video, seek, play, pause, set_playback), each done. get_state is
    // logged too (every registry.call() is, with no readOnly exemption) -- this test's own
    // verification calls to it are incidental, so assert the six actions are present rather than
    // an exact card count that would double as an assertion on how many times *this test*
    // happened to call get_state.
    await page.locator('button', { hasText: 'Activity' }).click();
    const cardTexts = await page.locator('[data-testid="tool-call-card"]').allTextContents();
    for (const action of ['list_library', 'load_video', 'seek', 'play', 'pause', 'set_playback']) {
      expect(cardTexts.some((text) => text.includes(action) && text.includes('done'))).toBe(true);
    }

    expect(consoleErrors).toEqual([]);
  });

  test('loading a YouTube source narrows the tool set to its yt-safe subset; loading a file restores it, and ontoolchange fires both times', async ({ page }) => {
    await page.goto('/');

    await execTool(page, 'load_video', { source: 'sample', id: 'sprite-fight' });
    // refreshLocalTools() runs off the store's own subscribe callback (fire-and-forget, not
    // awaited by load_video), so its registerTool() calls can still be in flight once load_video
    // resolves -- poll rather than snapshot listToolNames() once. Explicit 15s timeout (well past
    // Playwright's 5s default): each source-kind transition now unregisters/reregisters every
    // `local`-tagged tool (Task 7 added segment/track to that set), which can take noticeably
    // longer on a loaded CI runner than locally.
    await expect.poll(async () => listToolNames(page), { timeout: 15_000 }).toContain('step_frames');

    const toolchangeCount = await page.evaluate(async (id) => {
      let count = 0;
      document.modelContext!.addEventListener('toolchange', () => {
        count++;
      });
      await navigator.modelContextTesting!.executeTool('load_video', JSON.stringify({ source: 'youtube', url: `https://youtu.be/${id}` }));
      return count;
    }, 'jNQXAC9IVRw');
    expect(toolchangeCount).toBeGreaterThan(0);

    await expect.poll(async () => listToolNames(page), { timeout: 15_000 }).not.toContain('step_frames');
    // Every yt-unsafe local tool is gone, but every always tool is untouched.
    const withYoutube = await listToolNames(page);
    expect(withYoutube).toContain('get_state');
    expect(withYoutube).toContain('play');

    await execTool(page, 'load_video', { source: 'sample', id: 'sprite-fight' });
    await expect.poll(async () => listToolNames(page), { timeout: 15_000 }).toContain('step_frames');
  });

  test('window.agentVideo (the scripting bridge) can call seek, and the call is logged to Activity with via:"bridge"', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as unknown as { agentVideo?: unknown }).agentVideo));
    await execTool(page, 'load_video', { source: 'sample', id: 'sprite-fight' });

    const result = await page.evaluate(() =>
      (window as unknown as { agentVideo: { call(name: string, args?: unknown): Promise<unknown> } }).agentVideo.call('seek', { time: '+5' }),
    );
    expect(result).toMatchObject({ ok: true });

    const lastCallVia = await page.evaluate(() => {
      const store = (window as unknown as { __studioStore: { getState(): { activity: { via: string }[] } } }).__studioStore;
      const activity = store.getState().activity;
      return activity[activity.length - 1]?.via;
    });
    expect(lastCallVia).toBe('bridge');
  });

  test('#agent-tools carries a static JSON catalog of the tool set for a non-JS-executing reader', async ({ page }) => {
    await page.goto('/');
    const catalogJson = await page.locator('#agent-tools').textContent();
    const catalog = JSON.parse(catalogJson ?? '{}') as { tools: { name: string }[] };
    expect(catalog.tools.map((t) => t.name)).toContain('get_state');
  });
});
