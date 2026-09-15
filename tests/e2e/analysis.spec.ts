import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, '../fixtures/cuts.mp4');

/** Same waiting discipline as tests/e2e/tools-playback.spec.ts's execTool. */
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

/** Uploads the local fixture (scripts/fixture-gen-client.ts): 640x360, 8s, four 2s solid-color
 * scenes (red/green/blue/yellow, hard cuts at 2/4/6s) -- same fixture and wait discipline as
 * tests/e2e/segment.spec.ts's loadFixtureAndWaitReady. */
async function loadFixtureAndWaitReady(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('button', { hasText: 'Library' }).click();
  await page.setInputFiles('#video-file', FIXTURE_PATH);
  await expect(page.locator('header b')).toHaveText('cuts.mp4', { timeout: 15_000 });
  await expect.poll(() => duration(page), { timeout: 15_000 }).toBeGreaterThan(7);
}

test.describe('vision tools: detect_scenes/find_similar_frames', () => {
  test('detect_scenes finds the 3 hard cuts and adds 4 chapters (DoD: within 0.15s of 2/4/6s)', async ({ page }) => {
    test.setTimeout(60_000);
    await loadFixtureAndWaitReady(page);

    const result = await execTool(page, 'detect_scenes', { addChapters: true, waitSeconds: 40 });

    expect(result.ok).toBe(true);
    const scenes = result.scenes as { start: number; end: number }[];
    expect(scenes).toHaveLength(4);
    expect(scenes[0]!.start).toBeCloseTo(0, 1);
    expect(scenes[0]!.end).toBeCloseTo(2, 1);
    expect(scenes[1]!.end).toBeCloseTo(4, 1);
    expect(scenes[2]!.end).toBeCloseTo(6, 1);
    expect(scenes[3]!.end).toBeGreaterThan(7);

    const chapters = await execTool(page, 'list_chapters');
    expect(chapters.ok).toBe(true);
    expect((chapters.chapters as unknown[]).length).toBe(4);
  });

  test('find_similar_frames at 1s returns only scene-1 (red) ranges (DoD: color rejects the other solid scenes)', async ({ page }) => {
    test.setTimeout(60_000);
    await loadFixtureAndWaitReady(page);

    const result = await execTool(page, 'find_similar_frames', { time: '1.0', maxDistance: 10, waitSeconds: 40 });

    expect(result.ok).toBe(true);
    const ranges = result.ranges as { start: number; end: number }[];
    expect(ranges.length).toBeGreaterThan(0);
    // Every returned range must lie inside scene 1 (0-2s) -- the solid green/blue/yellow scenes
    // hash identically (dHash is blind to flat color) but must be excluded by the chi2 color
    // check, per the plan's own DoD line.
    for (const range of ranges) {
      expect(range.start).toBeGreaterThanOrEqual(0);
      expect(range.end).toBeLessThan(2);
    }
  });
});
