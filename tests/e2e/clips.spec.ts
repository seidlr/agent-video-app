import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, '../fixtures/cuts.mp4');

async function execTool(page: Page, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  await page.waitForFunction((toolName) => navigator.modelContextTesting?.listTools().some((t) => t.name === toolName) ?? false, name);
  const resultJson = await page.evaluate(
    async ({ name, argsJson }) => navigator.modelContextTesting!.executeTool(name, argsJson),
    { name, argsJson: JSON.stringify(args) },
  );
  return JSON.parse(resultJson ?? 'null') as Record<string, unknown>;
}

async function duration(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __studioStore: { getState(): { player: { duration: number } } } }).__studioStore.getState().player.duration);
}

test.describe('clips (Task 9 DoD, TS-007 step 1)', () => {
  test('add_clip creates clips that appear as timeline ranges and panel rows; remove_clip and reorder_clips work', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/');
    await page.locator('button', { hasText: 'Library' }).click();
    await page.setInputFiles('#video-file', FIXTURE_PATH);
    await expect(page.locator('header b')).toHaveText('cuts.mp4', { timeout: 15_000 });
    await expect.poll(() => duration(page), { timeout: 15_000 }).toBeGreaterThan(7);

    const first = await execTool(page, 'add_clip', { start: '0.5', end: '2.5', name: 'red' });
    expect(first.ok).toBe(true);
    const second = await execTool(page, 'add_clip', { start: '4', end: '5' });
    expect(second.ok).toBe(true);

    const listed = await execTool(page, 'list_clips');
    expect(listed.ok).toBe(true);
    const clips = listed.clips as { id: string; start: number; end: number; name?: string }[];
    expect(clips).toHaveLength(2);
    expect(clips[0]!.end - clips[0]!.start).toBeCloseTo(2, 1);
    expect(clips[1]!.end - clips[1]!.start).toBeCloseTo(1, 1);

    // Timeline shows clip ranges.
    await expect(page.getByRole('button', { name: /Seek to clip 1: red/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Seek to clip 2' })).toBeVisible();

    // Clips panel lists both, with durations.
    await page.locator('button', { hasText: 'Clips' }).click();
    await expect(page.getByText('2.0s')).toBeVisible();
    await expect(page.getByText('1.0s')).toBeVisible();

    // reorder_clips.
    const reordered = await execTool(page, 'reorder_clips', { order: [clips[1]!.id, clips[0]!.id] });
    expect(reordered.ok).toBe(true);
    const afterReorder = (await execTool(page, 'list_clips')).clips as { id: string; order: number }[];
    expect(afterReorder.find((c) => c.id === clips[1]!.id)?.order).toBe(0);

    // remove_clip.
    const removed = await execTool(page, 'remove_clip', { clipId: clips[0]!.id });
    expect(removed.ok).toBe(true);
    const finalList = (await execTool(page, 'list_clips')).clips as unknown[];
    expect(finalList).toHaveLength(1);
  });
});
