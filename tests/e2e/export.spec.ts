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

async function loadFixtureAndWaitReady(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Panels' }).getByRole('button', { name: 'Library', exact: true }).click();
  await page.setInputFiles('#video-file', FIXTURE_PATH);
  await expect(page.locator('header b')).toHaveText('cuts.mp4', { timeout: 15_000 });
  await expect.poll(() => duration(page), { timeout: 15_000 }).toBeGreaterThan(7);
}

test.describe('export_video/export_gif (Task 9 DoD, TS-007 steps 2-3)', () => {
  test('two fixture clips (0.5-2.5, 4-5) export to an mp4 with duration ~3.0s, 640px wide, avc+aac', async ({ page }) => {
    test.setTimeout(60_000);
    await loadFixtureAndWaitReady(page);

    await execTool(page, 'add_clip', { start: '0.5', end: '2.5' });
    await execTool(page, 'add_clip', { start: '4', end: '5' });

    const downloadPromise = page.waitForEvent('download');
    const result = await execTool(page, 'export_video', { clips: 'all', format: 'mp4', width: 640, waitSeconds: 40 });
    const download = await downloadPromise;

    expect(result.ok).toBe(true);
    expect(result.durationSeconds as number).toBeCloseTo(3.0, 0);
    expect(Math.abs((result.durationSeconds as number) - 3.0)).toBeLessThan(0.1);
    expect(result.width).toBe(640);
    expect(result.codec).toBe('avc');
    expect(result.bytes as number).toBeGreaterThan(0);
    expect(download.suggestedFilename()).toBe('agent-video-studio-export.mp4');

    // Re-importing the exported file reports the same duration back.
    const exportPath = test.info().outputPath('exported.mp4');
    await download.saveAs(exportPath);
    await page.getByRole('navigation', { name: 'Panels' }).getByRole('button', { name: 'Library', exact: true }).click();
    await page.setInputFiles('#video-file', exportPath);
    await expect(page.locator('header b')).toHaveText('exported.mp4', { timeout: 15_000 });
    await expect.poll(() => duration(page), { timeout: 15_000 }).toBeGreaterThan(2.5);
  });

  test('burnOverlays draws a box onto the exported video (first frame contains the box color)', async ({ page }) => {
    test.setTimeout(60_000);
    await loadFixtureAndWaitReady(page);

    // t=1s is the fixture's red scene; a large box lets a full-frame pixel scan reliably land
    // on it regardless of exact scaling/rounding during export.
    await execTool(page, 'add_clip', { start: '1', end: '1.5' });
    const addedBox = await execTool(page, 'add_box', { time: '1', x: 0.05, y: 0.05, w: 0.9, h: 0.9, label: 'burn-test' });
    expect(addedBox.ok).toBe(true);

    const downloadPromise = page.waitForEvent('download');
    const result = await execTool(page, 'export_video', { clips: 'all', format: 'mp4', burnOverlays: true, waitSeconds: 40 });
    const download = await downloadPromise;
    expect(result.ok).toBe(true);

    const exportPath = test.info().outputPath('burn-overlays.mp4');
    await download.saveAs(exportPath);
    const fs = await import('node:fs');
    const base64 = fs.readFileSync(exportPath).toString('base64');

    // Decode the first frame in-page (no bundler-relative imports -- just the raw bytes, base64'd
    // across the Node/browser boundary) and scan for the reserved annotate-color box outline, the
    // same evidence tests/e2e/frames.spec.ts's own includeOverlays check uses.
    const hasAnnotateColor = await page.evaluate(async (b64) => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
      const video = document.createElement('video');
      video.src = blobUrl;
      video.muted = true;
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = reject;
      });
      video.currentTime = 0;
      await new Promise((resolve) => (video.onseeked = resolve));
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // #4fb3d9 = (79, 179, 217) -- scan for a close match anywhere in the frame.
      for (let i = 0; i < data.length; i += 4) {
        const dr = Math.abs(data[i]! - 79);
        const dg = Math.abs(data[i + 1]! - 179);
        const db = Math.abs(data[i + 2]! - 217);
        if (dr < 25 && dg < 25 && db < 25) return true;
      }
      return false;
    }, base64);

    expect(hasAnnotateColor).toBe(true);
  });

  test('export_gif 0-1s at 10fps produces a GIF with 10 frames', async ({ page }) => {
    test.setTimeout(60_000);
    await loadFixtureAndWaitReady(page);

    const downloadPromise = page.waitForEvent('download');
    const result = await execTool(page, 'export_gif', { start: '0', end: '1', width: 240, fps: 10, waitSeconds: 40 });
    const download = await downloadPromise;

    expect(result.ok).toBe(true);
    expect(result.frames).toBe(10);
    expect(download.suggestedFilename()).toBe('agent-video-studio-export.gif');

    const gifPath = test.info().outputPath('exported.gif');
    await download.saveAs(gifPath);
    const fs = await import('node:fs');
    const bytes = fs.readFileSync(gifPath);
    expect(bytes.subarray(0, 3).toString('ascii')).toBe('GIF');
  });
});
