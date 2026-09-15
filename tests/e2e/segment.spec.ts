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

/** Uploads the local fixture (scripts/fixture-gen-client.ts): 640x360, 8s, with a white 60px
 * square moving left->right from x=10% to x=60% of width during 0-2s -- the only source in this
 * app with real, known, trackable motion (the "Sprite Fight" sample has none). Waits for the real
 * `<video>` element to have metadata, same as tests/e2e/frames.spec.ts's loadFixtureAndWaitReady. */
async function loadFixtureAndWaitReady(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await page.locator('button', { hasText: 'Library' }).click();
  await page.setInputFiles('#video-file', FIXTURE_PATH);
  await expect(page.locator('header b')).toHaveText('cuts.mp4', { timeout: 15_000 });
  await expect.poll(() => duration(page), { timeout: 15_000 }).toBeGreaterThan(7);
}

test.describe('vision tools: segment/track/models @ml', () => {
  test('list_models/load_model/unload_model (Task 7 DoD)', async ({ page }) => {
    test.setTimeout(180_000);
    const hubRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('huggingface.co')) hubRequests.push(req.url());
    });

    await page.goto('/');

    // DoD: list_models reports every catalog entry with a numeric sizeMB and cached:false on a
    // fresh profile.
    const listed = await execTool(page, 'list_models');
    expect(listed.ok).toBe(true);
    const models = listed.models as { id: string; sizeMB: number; cached: boolean; loaded: boolean }[];
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(typeof model.sizeMB).toBe('number');
      expect(model.sizeMB).toBeGreaterThan(0);
    }
    const edgetamRow = models.find((m) => m.id === 'edgetam');
    expect(edgetamRow).toMatchObject({ cached: false, loaded: false });

    // DoD: network inspection shows zero huggingface.co requests until the first confirmed
    // load_model/tool call.
    expect(hubRequests).toEqual([]);

    // DoD: without confirmDownload, load_model returns model_not_loaded naming the MB.
    const withoutConfirm = await execTool(page, 'load_model', { id: 'edgetam' });
    expect(withoutConfirm).toMatchObject({ ok: false, error: 'model_not_loaded' });
    expect(withoutConfirm.hint as string).toContain(`${edgetamRow!.sizeMB}MB`);
    expect(hubRequests).toEqual([]); // still nothing fetched from a mere size-checking call

    // DoD: with confirmDownload, the job completes and loaded:true.
    const withConfirm = await execTool(page, 'load_model', { id: 'edgetam', confirmDownload: true, waitSeconds: 60 });
    expect(withConfirm.ok).toBe(true);
    expect(hubRequests.length).toBeGreaterThan(0); // the actual download happened now

    const afterLoad = await execTool(page, 'list_models');
    expect((afterLoad.models as { id: string; loaded: boolean }[]).find((m) => m.id === 'edgetam')).toMatchObject({ loaded: true });

    // DoD: unload_model flips loaded back to false.
    const unloaded = await execTool(page, 'unload_model', { id: 'edgetam' });
    expect(unloaded.ok).toBe(true);
    const afterUnload = await execTool(page, 'list_models');
    expect((afterUnload.models as { id: string; loaded: boolean }[]).find((m) => m.id === 'edgetam')).toMatchObject({ loaded: false });
  });

  test('segment finds the moving square at t=1s (DoD: webgpu)', async ({ page }) => {
    test.setTimeout(180_000);
    await loadFixtureAndWaitReady(page);
    await execTool(page, 'seek', { time: '1' });

    // Square at t=1s: x in [194,254] of 640, y in [150,210] of 360 -> normalized center
    // (0.35, 0.5), matching the plan's own DoD assertion value exactly.
    const result = await execTool(page, 'segment', { points: [{ x: 0.35, y: 0.5, label: 1 }], confirmDownload: true, waitSeconds: 60 });

    expect(result.ok).toBe(true);
    const box = result.box as { x: number; y: number; w: number; h: number };
    expect(box.x).toBeLessThanOrEqual(0.35);
    expect(box.x + box.w).toBeGreaterThanOrEqual(0.35);
    expect(result.score as number).toBeGreaterThanOrEqual(0.7);
  });

  test('segment finds the moving square at t=1s (DoD: ?ml=wasm)', async ({ page }) => {
    test.setTimeout(180_000);
    await loadFixtureAndWaitReady(page, '?ml=wasm');
    await execTool(page, 'seek', { time: '1' });

    const result = await execTool(page, 'segment', { points: [{ x: 0.35, y: 0.5, label: 1 }], confirmDownload: true, waitSeconds: 90 });

    expect(result.ok).toBe(true);
    const box = result.box as { x: number; y: number; w: number; h: number };
    expect(box.x).toBeLessThanOrEqual(0.35);
    expect(box.x + box.w).toBeGreaterThanOrEqual(0.35);
    expect(result.score as number).toBeGreaterThanOrEqual(0.7);
  });

  test('track follows the moving square from t=1s to 2s (DoD: >=4 keyframes, strictly increasing x)', async ({ page }) => {
    test.setTimeout(180_000);
    await loadFixtureAndWaitReady(page);
    await execTool(page, 'seek', { time: '1' });

    const segmentResult = await execTool(page, 'segment', { points: [{ x: 0.35, y: 0.5, label: 1 }], confirmDownload: true, waitSeconds: 60 });
    expect(segmentResult.ok).toBe(true);

    const trackResult = await execTool(page, 'track', { boxId: segmentResult.boxId as string, until: '2', stepSeconds: 0.25, waitSeconds: 60 });
    expect(trackResult.ok).toBe(true);
    const keyframes = trackResult.keyframes as { time: number; box: { x: number } }[];
    expect(keyframes.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < keyframes.length; i++) {
      expect(keyframes[i]!.box.x).toBeGreaterThan(keyframes[i - 1]!.box.x);
    }
  });
});
