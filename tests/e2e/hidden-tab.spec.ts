import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function execTool(page: Page, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  await page.waitForFunction((toolName) => navigator.modelContextTesting?.listTools().some((t) => t.name === toolName) ?? false, name);
  const resultJson = await page.evaluate(
    async ({ name, argsJson }) => navigator.modelContextTesting!.executeTool(name, argsJson),
    { name, argsJson: JSON.stringify(args) },
  );
  return JSON.parse(resultJson ?? 'null') as Record<string, unknown>;
}

/**
 * Found live: the studio page an agent handed out (?bus=...) was open in a background tab. Chrome
 * doesn't load video in a tab that has never been shown, so the agent saw a 0:00, 0x0 video, and seek
 * answered ok at 00:00 -- the human only noticed after switching to the tab, when it loaded. The
 * tools now say what's wrong, and the tab's title asks to be shown.
 */
test('in a background tab, load_video warns, seek fails with a clear hint, and the title asks to be shown', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  });
  // Never answered: what a deferred background-tab load looks like from the page.
  await page.route('https://files.vidstack.io/sprite-fight/720p.mp4', () => undefined);
  await page.goto('/');

  const loaded = await execTool(page, 'load_video', { source: 'sample', id: 'sprite-fight' });
  expect(loaded).toMatchObject({ ok: true, tabHidden: true, summary: expect.stringContaining('background') });

  const seeked = await execTool(page, 'seek', { time: '1:24' });
  expect(seeked).toMatchObject({ ok: false, error: 'video_not_ready', hint: expect.stringContaining('front') });

  await expect(page).toHaveTitle(/^▶ Show this tab/);
});
