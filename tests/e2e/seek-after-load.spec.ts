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
 * Found live in the MCP App: open_video_studio hands the view a video to load, the view starts that
 * load itself, and the agent -- seeing the title in get_state -- seeks right away. The seek arrived
 * before the video had metadata, the browser dropped it, and the tool still answered ok with
 * "Playhead at 00:00.000". Reproduced here by starting the load without waiting for it.
 */
test('a seek issued while the video is still loading lands where it was asked, instead of silently staying at 0', async ({ page }) => {
  // Hold the video's response back so the seek deterministically lands before metadata arrives
  // (a warm cache otherwise shrinks the window to a few ms).
  await page.route('https://files.vidstack.io/sprite-fight/720p.mp4', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue();
  });
  await page.goto('/');
  await page.waitForFunction(() => navigator.modelContextTesting?.listTools().some((t) => t.name === 'load_video') ?? false);
  await page.evaluate(() => void navigator.modelContextTesting!.executeTool('load_video', JSON.stringify({ source: 'sample', id: 'sprite-fight' })));
  await expect.poll(async () => (await execTool(page, 'get_state')).summary as string).toContain('Sprite Fight');

  const seeked = await execTool(page, 'seek', { time: '1:24' });
  expect(seeked).toMatchObject({ ok: true, summary: expect.stringContaining('01:24') });
});
