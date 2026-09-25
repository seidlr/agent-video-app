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
 * User-requested (mid-session): agent tool calls are otherwise silent unless the Activity tab
 * happens to be open. A transient toast, visible from any panel tab, gives ambient visibility
 * into "what did the agent just do" without requiring a tab switch.
 */
test.describe('activity toast (ambient tool-call notification)', () => {
  test('shows a toast for a tool call from any panel tab, and it auto-dismisses', async ({ page }) => {
    await page.goto('/');
    await execTool(page, 'load_video', { source: 'sample', id: 'sprite-fight' });

    // Switch away from Activity so the toast is proven to work without that tab being open.
    await page.locator('button', { hasText: 'Notes' }).first().click();

    await execTool(page, 'seek', { time: '2' });

    const toast = page.getByTestId('activity-toast').filter({ hasText: 'seek' });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('done');

    // Auto-dismiss: gone well before a human would still be looking for it, without lingering forever.
    await expect(toast).not.toBeVisible({ timeout: 8000 });
  });

  test('a dismissed toast stays dismissed when the agent makes its next call', async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto('/');
    await execTool(page, 'load_video', { source: 'sample', id: 'sprite-fight' });
    await execTool(page, 'seek', { time: '2' });

    const seekToast = page.getByTestId('activity-toast').filter({ hasText: 'seek' });
    await expect(seekToast).not.toBeVisible({ timeout: 8000 });

    await execTool(page, 'get_state');
    await expect(page.getByTestId('activity-toast').filter({ hasText: 'get_state' })).toBeVisible();
    // A point-in-time count, not toHaveCount (which would retry until a re-shown toast timed out again).
    expect(await seekToast.count()).toBe(0);
  });

  test('a burst of calls shows only the few most recent toasts, not the whole history', async ({ page }) => {
    await page.goto('/');
    await execTool(page, 'load_video', { source: 'sample', id: 'sprite-fight' });
    for (const time of ['1', '2', '3', '4', '5', '6']) await execTool(page, 'seek', { time });

    const toasts = page.getByTestId('activity-toast');
    await expect(toasts.last()).toBeVisible();
    expect(await toasts.count()).toBeLessThanOrEqual(3);
  });
});
