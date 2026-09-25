import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, '../fixtures/cuts.mp4');

/**
 * Same waiting discipline as tests/e2e/tools-playback.spec.ts's execTool: wait for the exact tool
 * name about to be called, since @mcp-b/global's polyfill installing navigator.modelContextTesting
 * doesn't mean every mountWebMcp() registerTool() call has landed yet.
 */
async function execTool(page: Page, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  await page.waitForFunction((toolName) => navigator.modelContextTesting?.listTools().some((t) => t.name === toolName) ?? false, name);
  const resultJson = await page.evaluate(
    async ({ name, argsJson }) => navigator.modelContextTesting!.executeTool(name, argsJson),
    { name, argsJson: JSON.stringify(args) },
  );
  return JSON.parse(resultJson ?? 'null') as Record<string, unknown>;
}

async function openLibraryTab(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Panels' }).getByRole('button', { name: 'Library', exact: true }).click();
}

async function openFramesTab(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Panels' }).getByRole('button', { name: 'Frames', exact: true }).click();
}

async function duration(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __studioStore: { getState(): { player: { duration: number } } } }).__studioStore.getState().player.duration);
}

/** Uploads the fixture and waits until the real `<video>` element has metadata (duration/
 * dimensions) loaded -- capture_frame reads pixels straight from that element, so it needs to be
 * ready; generate_thumbnails instead reads the raw file via mediabunny and doesn't. */
async function loadFixtureAndWaitReady(page: Page): Promise<void> {
  await page.goto('/');
  await openLibraryTab(page);
  await page.setInputFiles('#video-file', FIXTURE_PATH);
  await expect(page.locator('header b')).toHaveText('cuts.mp4', { timeout: 15_000 });
  await expect.poll(() => duration(page), { timeout: 15_000 }).toBeGreaterThan(7);
}

/** Fetches `url` (a blob: or data: URL, both fetchable in-page) as an image and samples one pixel
 * -- runs entirely in the browser since Node has no PNG/WEBP decoder available here. */
async function samplePixel(page: Page, url: string, x: number, y: number): Promise<[number, number, number, number]> {
  return page.evaluate(
    async ({ url, x, y }) => {
      const blob = await fetch(url).then((r) => r.blob());
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(Math.round(x), Math.round(y), 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },
    { url, x, y },
  ) as Promise<[number, number, number, number]>;
}

function expectColorClose(actual: [number, number, number, number], expected: [number, number, number], tolerance = 30): void {
  const [ar, ag, ab] = actual;
  const [er, eg, eb] = expected;
  const message = `${[ar, ag, ab]} vs ${expected} (tolerance ${tolerance})`;
  expect(Math.abs(ar - er), message).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(ag - eg), message).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(ab - eb), message).toBeLessThanOrEqual(tolerance);
}

// Fixture colors (scripts/fixture-gen-client.ts SCENES): red [0,2), green [2,4), blue [4,6),
// yellow [6,8). t=1s is solidly inside the red scene, t=3s solidly inside the green one.
const RED: [number, number, number] = [255, 0, 0];
const GREEN: [number, number, number] = [0, 170, 0];
const ANNOTATE: [number, number, number] = [79, 179, 217]; // --color-annotate, #4fb3d9

test.describe('frame capture channels (Task 5 DoD, TS-003)', () => {
  test('DoD: captured PNG pixel at a known fixture position matches the frame color (red at t=1s, green at t=3s)', async ({ page }) => {
    await loadFixtureAndWaitReady(page);

    const atRed = await execTool(page, 'capture_frame', { time: '1.0', format: 'png', includeDataUrl: true });
    expect(atRed).toMatchObject({ ok: true, width: 640, height: 360 });
    expectColorClose(await samplePixel(page, atRed.dataUrl as string, 320, 180), RED);

    const atGreen = await execTool(page, 'capture_frame', { time: '3.0', format: 'png', includeDataUrl: true });
    expect(atGreen).toMatchObject({ ok: true, width: 640, height: 360 });
    expectColorClose(await samplePixel(page, atGreen.dataUrl as string, 320, 180), GREEN);
  });

  test('TS-003 step 1: capture_frame with time/format/download/name downloads the deterministic filename and shows the frame in the tray', async ({ page }) => {
    await loadFixtureAndWaitReady(page);

    const downloadPromise = page.waitForEvent('download');
    const result = await execTool(page, 'capture_frame', { time: '2.0', format: 'png', download: true, name: 'frame-2s' });
    const download = await downloadPromise;

    expect(result).toMatchObject({ ok: true, width: 640, height: 360, downloadedAs: 'frame-2s-00-02-000.png' });
    expect(typeof result.frameId).toBe('string');
    expect(download.suggestedFilename()).toBe('frame-2s-00-02-000.png');

    await openFramesTab(page);
    await expect(page.getByText('00:02.000', { exact: false })).toBeVisible();
    await expect(page.getByText('Saved to Downloads as frame-2s-00-02-000.png')).toBeVisible();
  });

  test('TS-003 step 2: includeDataUrl returns a decodable PNG scaled to maxWidth', async ({ page }) => {
    await loadFixtureAndWaitReady(page);

    const result = await execTool(page, 'capture_frame', { includeDataUrl: true, maxWidth: 320 });
    expect(result.ok).toBe(true);
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.width).toBe(320);

    const decodedWidth = await page.evaluate(
      (dataUrl) =>
        new Promise<number>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img.naturalWidth);
          img.onerror = () => reject(new Error('failed to decode dataUrl'));
          img.src = dataUrl;
        }),
      result.dataUrl as string,
    );
    expect(decodedWidth).toBe(320);
  });

  test('TS-003 step 3: includeOverlays draws the reserved annotate-color box outline at the box edge', async ({ page }) => {
    await loadFixtureAndWaitReady(page);

    // add_box is a Task 6 tool (not yet built); the store action it will wrap already exists
    // (studio.ts, scaffolded in Task 2/3), so drive it directly here exactly like the existing
    // "URL source resolves and plays" e2e test drives loadSource directly.
    await page.evaluate(() => {
      const store = (window as unknown as { __studioStore: { getState(): { addBox(input: Record<string, unknown>): string } } }).__studioStore;
      store.getState().addBox({ time: 2.0, x: 0.1, y: 0.1, w: 0.3, h: 0.3, label: 'test', source: 'agent' });
    });

    const result = await execTool(page, 'capture_frame', { time: '2.0', includeOverlays: true, includeDataUrl: true });
    expect(result.ok).toBe(true);

    // Box in normalized coords (0.1,0.1,0.3,0.3) on a 640x360 canvas -> pixel rect (64,36,192,108);
    // sample the middle of the left edge, where the 2px stroke is centered on x=64.
    expectColorClose(await samplePixel(page, result.dataUrl as string, 64, 90), ANNOTATE, 60);
  });

  test('TS-003 step 4: a YouTube source returns youtube_pixels_unavailable with a tab-capture hint, and the button is visible', async ({ page }) => {
    await page.goto('/');
    await execTool(page, 'load_video', { source: 'youtube', url: 'https://youtu.be/_cMxraX_5RE' });
    await expect(page.locator('header b')).not.toHaveText('no video loaded');

    const result = await execTool(page, 'capture_frame');
    expect(result).toMatchObject({ ok: false, error: 'youtube_pixels_unavailable' });
    expect(result.hint).toContain('tab-capture');

    await expect(page.getByRole('button', { name: 'Enable tab capture for frame capture' })).toBeVisible();
  });
});

test.describe('thumbnails (Task 5 DoD, TS-002 step 2)', () => {
  test('generate_thumbnails produces a sprite <=300KB with a 12-cue VTT, a 12-tile Filmstrip strip, and the correct green tile near 3s', async ({ page }) => {
    await loadFixtureAndWaitReady(page);

    const result = await execTool(page, 'generate_thumbnails', { count: 12, contactSheet: true });
    expect(result.ok).toBe(true);
    expect(result.timestamps).toHaveLength(12);
    expect(typeof result.contactSheetFrameId).toBe('string');

    const source = await page.evaluate(
      () =>
        (window as unknown as { __studioStore: { getState(): { source: { thumbnailsVttUrl?: string; thumbnailsSpriteUrl?: string } } } }).__studioStore.getState()
          .source,
    );
    expect(source.thumbnailsVttUrl).toBeTruthy();
    expect(source.thumbnailsSpriteUrl).toBeTruthy();

    // Sprite size and VTT cue count -- DoD's explicit numeric gates.
    const spriteSize = await page.evaluate((url) => fetch(url).then((r) => r.blob()).then((b) => b.size), source.thumbnailsSpriteUrl as string);
    expect(spriteSize).toBeLessThanOrEqual(300 * 1024);

    const vttText = await page.evaluate((url) => fetch(url).then((r) => r.text()), source.thumbnailsVttUrl as string);
    const cueCount = (vttText.match(/ --> /g) ?? []).length;
    expect(cueCount).toBe(12);

    // The persistent Filmstrip strip under the timeline shows all 12 tiles.
    await expect(page.locator('[aria-label^="Frame preview at"]')).toHaveCount(12);

    // The tile nearest 3s (green scene) really is green: find its index from the tool's own
    // reported timestamps (rather than assuming the even-spread math), then sample the same
    // sprite pixel the CSS crop for that tile would show (col*160+80, row*90+45 -- tile center).
    const timestamps = result.timestamps as number[];
    const index = timestamps.reduce((closest, t, i) => (Math.abs(t - 3) < Math.abs((timestamps[closest] ?? Infinity) - 3) ? i : closest), 0);
    const col = index % 10;
    const row = Math.floor(index / 10);
    expectColorClose(await samplePixel(page, source.thumbnailsSpriteUrl as string, col * 160 + 80, row * 90 + 45), GREEN, 40);
  });
});
