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
});
