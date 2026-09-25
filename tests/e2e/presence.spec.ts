import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Same waiting discipline as tests/e2e/tools-playback.spec.ts's execTool. */
async function execTool(page: Page, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  await page.waitForFunction((toolName) => navigator.modelContextTesting?.listTools().some((t) => t.name === toolName) ?? false, name);
  const resultJson = await page.evaluate(
    async ({ name, argsJson }) => navigator.modelContextTesting!.executeTool(name, argsJson),
    { name, argsJson: JSON.stringify(args) },
  );
  return JSON.parse(resultJson ?? 'null') as Record<string, unknown>;
}

/**
 * User-requested: a human should see what the agent just called without opening the Activity
 * tab ("a short chip/toast of what function the agent just called"), and later "not so many
 * toasts". The top bar's agent-presence chip is that one indicator: it updates in place for
 * every call instead of stacking a toast per call over the video.
 */
test.describe('agent presence (ambient tool-call indicator)', () => {
  test('shows the latest tool call from any panel tab', async ({ page }) => {
    await page.goto('/');
    await execTool(page, 'load_video', { source: 'sample', id: 'sprite-fight' });
    await page.getByRole('navigation', { name: 'Panels' }).getByRole('button', { name: 'Notes', exact: true }).click();

    await execTool(page, 'seek', { time: '2' });

    const current = page.getByTestId('agent-presence-call');
    await expect(current).toContainText('seek');
    await expect(current).toContainText('done');
  });

  test('a burst of calls updates one indicator in place instead of stacking', async ({ page }) => {
    await page.goto('/');
    await execTool(page, 'load_video', { source: 'sample', id: 'sprite-fight' });
    for (const time of ['1', '2', '3', '4', '5', '6']) await execTool(page, 'seek', { time });
    await execTool(page, 'get_state');

    await expect(page.getByTestId('agent-presence-call')).toContainText('get_state');
    expect(await page.getByTestId('agent-presence-call').count()).toBe(1);
    await expect(page.getByTestId('agent-presence')).toContainText('8 calls');
  });

  test('clicking the indicator opens the Activity panel', async ({ page }) => {
    await page.goto('/');
    await execTool(page, 'load_video', { source: 'sample', id: 'sprite-fight' });
    await page.getByRole('navigation', { name: 'Panels' }).getByRole('button', { name: 'Library', exact: true }).click();

    await page.getByTestId('agent-presence').click();

    await expect(page.getByTestId('tool-call-card').first()).toContainText('load_video');
  });
});
