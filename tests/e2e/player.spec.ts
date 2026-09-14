import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, '../fixtures/cuts.mp4');

/**
 * Pads the repo's small 8 s/640x360 fixture past 50 MB with a trailing ISO-BMFF `free` box, so
 * Task 3's "dropped 50 MB file" DoD line is exercised against a real, still-decodable video
 * without committing a 50 MB binary to the repo. Box parsers (including Chromium's own demuxer)
 * walk the file box-by-box via each box's own length prefix rather than assuming EOF at the last
 * meaningful box, so an unknown trailing `free` box is simply skipped -- verified against
 * mediabunny's Input in isolation before writing this test (duration/track were unaffected).
 * Written to a real OS temp file: Playwright's setInputFiles refuses an in-memory buffer over 50 MB.
 */
function buildOversizedFixture(): string {
  const base = readFileSync(FIXTURE_PATH);
  const targetSize = 50 * 1024 * 1024 + 1024; // just over 50 MB
  const padNeeded = targetSize - base.length - 8; // 8-byte box header (size + fourcc)
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + padNeeded, 0);
  header.write('free', 4, 'ascii');
  const padded = Buffer.concat([base, header, Buffer.alloc(padNeeded)]);
  const tmpPath = path.join(os.tmpdir(), `agent-video-app-big-clip-${process.pid}-${Date.now()}.mp4`);
  writeFileSync(tmpPath, padded);
  return tmpPath;
}

/** Polls the exposed dev-only store (window.__studioStore, wired in src/main.tsx) rather than
 * scraping the DOM for numbers that update every animation frame. */
async function currentTime(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __studioStore: { getState(): { player: { currentTime: number } } } }).__studioStore.getState().player.currentTime);
}

async function isPaused(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { __studioStore: { getState(): { player: { paused: boolean } } } }).__studioStore.getState().player.paused);
}

async function isMuted(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { __studioStore: { getState(): { player: { muted: boolean } } } }).__studioStore.getState().player.muted);
}

/** The right-rail panel defaults to Activity (Task 4's placeholder); the sample list and drop
 * zone only render once the Library tab is selected. */
async function openLibraryTab(page: Page): Promise<void> {
  await page.locator('button', { hasText: 'Library' }).click();
}

/** Matches both the initial big center button (PlayOverlay, aria-label "Play video") and, after
 * a reload remounts VideoStage with hasPlayed reset to false, the same overlay again -- i.e. the
 * affordance an actual first-time viewer clicks, on every "start playback" point in these tests. */
async function clickPlayOverlay(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Play video' }).click();
}

test.describe('player sources (Task 3 DoD)', () => {
  test('sample source plays', async ({ page }) => {
    await page.goto('/');
    await openLibraryTab(page);
    await page.locator('button', { hasText: 'Sprite Fight' }).click();
    await expect(page.locator('header b')).toHaveText('Sprite Fight');

    await clickPlayOverlay(page);
    await expect.poll(() => currentTime(page), { timeout: 10_000 }).toBeGreaterThan(0);
  });

  test('URL source resolves and plays', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as unknown as { __studioStore?: unknown }).__studioStore));

    await page.evaluate(async () => {
      const store = (window as unknown as { __studioStore: { getState(): unknown } }).__studioStore;
      // @ts-expect-error resolved by the Vite dev server inside the browser, not by this repo's tsc project
      const { loadSource } = await import('/src/media/load.ts');
      await loadSource(store.getState() as Parameters<typeof loadSource>[0], {
        kind: 'url',
        url: 'https://files.vidstack.io/sprite-fight/720p.mp4',
      });
    });

    await expect(page.locator('header b')).toHaveText('720p.mp4');
    await clickPlayOverlay(page);
    await expect.poll(() => currentTime(page), { timeout: 10_000 }).toBeGreaterThan(0);
  });

  test('YouTube source shows the oEmbed title and the 4-thumbnail filmstrip', async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as unknown as { __studioStore?: unknown }).__studioStore));

    const videoId = 'jNQXAC9IVRw'; // "Me at the zoo" -- the first YouTube upload; stable metadata.
    const result = await page.evaluate(async (id) => {
      const store = (window as unknown as { __studioStore: { getState(): unknown } }).__studioStore;
      // @ts-expect-error resolved by the Vite dev server inside the browser, not by this repo's tsc project
      const { loadSource } = await import('/src/media/load.ts');
      await loadSource(store.getState() as Parameters<typeof loadSource>[0], { kind: 'youtube', url: `https://youtu.be/${id}` });
      const source = (store.getState() as { source: { title: string; filmstripUrls?: string[] } }).source;
      const imgs = Array.from(document.querySelectorAll('img[alt^="Frame preview"]')) as HTMLImageElement[];
      return { title: source.title, filmstripUrls: source.filmstripUrls, imgSrcs: imgs.map((img) => img.getAttribute('src')) };
    }, videoId);

    expect(result.title).not.toBe('YouTube video'); // the oEmbed fetch succeeded, not the fallback
    expect(result.title.length).toBeGreaterThan(0);
    const expectedThumbs = [0, 1, 2, 3].map((i) => `https://i.ytimg.com/vi/${videoId}/${i}.jpg`);
    expect(result.filmstripUrls).toEqual(expectedThumbs);
    expect(result.imgSrcs).toEqual(expectedThumbs);

    await expect(page.locator('header b')).toHaveText(result.title);
  });

  test('a dropped 50 MB local file appears in the Library and plays after a full page reload, without re-selecting it', async ({ page }) => {
    test.setTimeout(90_000);
    const tmpPath = buildOversizedFixture();
    try {
      await page.goto('/');
      await openLibraryTab(page);
      await page.setInputFiles('#video-file', tmpPath);

      // importFile (OPFS write of ~50 MB + Dexie insert) then the auto-load both need time.
      await expect(page.locator('header b')).toHaveText(path.basename(tmpPath), { timeout: 30_000 });
      await expect(page.locator('button', { hasText: path.basename(tmpPath) })).toBeVisible();

      await clickPlayOverlay(page);
      await expect.poll(() => currentTime(page), { timeout: 10_000 }).toBeGreaterThan(0);

      await page.reload();

      // No click on the Library card: main.tsx restores the last-loaded source from Dexie on boot.
      await expect(page.locator('header b')).toHaveText(path.basename(tmpPath), { timeout: 15_000 });
      await clickPlayOverlay(page);
      await expect.poll(() => currentTime(page), { timeout: 10_000 }).toBeGreaterThan(0);
    } finally {
      unlinkSync(tmpPath);
    }
  });
});

test.describe('keyboard shortcuts (Task 3 DoD)', () => {
  test('Space toggles play, arrows seek 5s, ,/. step one frame while paused, M mutes', async ({ page }) => {
    await page.goto('/');
    await openLibraryTab(page);
    await page.locator('button', { hasText: 'Sprite Fight' }).click();
    await clickPlayOverlay(page);
    await expect.poll(() => currentTime(page), { timeout: 10_000 }).toBeGreaterThan(0);

    const player = page.locator('[data-media-player]');
    await player.focus();

    // Space toggles play/pause (vidstack's own MEDIA_KEY_SHORTCUTS, keyTarget:'player' default).
    await page.keyboard.press('Space');
    await expect.poll(() => isPaused(page)).toBe(true);

    const pausedAt = await currentTime(page);

    // Comma/period step exactly one frame (1/30s @ fps:30) while paused -- our custom handler.
    await page.keyboard.press(',');
    await expect.poll(() => currentTime(page)).toBeLessThan(pausedAt);
    const afterBack = await currentTime(page);
    expect(pausedAt - afterBack).toBeCloseTo(1 / 30, 2);

    await page.keyboard.press('.');
    await expect.poll(() => currentTime(page)).toBeCloseTo(pausedAt, 2);

    // Arrow keys seek +/-5s (vidstack built-in).
    const beforeSeek = await currentTime(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => currentTime(page)).toBeGreaterThan(beforeSeek + 4);
    const afterForward = await currentTime(page);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => currentTime(page)).toBeLessThan(afterForward - 4);

    // M mutes/unmutes (vidstack built-in).
    await page.keyboard.press('m');
    await expect.poll(() => isMuted(page)).toBe(true);
    await page.keyboard.press('m');
    await expect.poll(() => isMuted(page)).toBe(false);

    // Space resumes play.
    await page.keyboard.press('Space');
    await expect.poll(() => isPaused(page)).toBe(false);
  });

  test('F toggles fullscreen', async ({ page }) => {
    await page.goto('/');
    await openLibraryTab(page);
    await page.locator('button', { hasText: 'Sprite Fight' }).click();
    const player = page.locator('[data-media-player]');
    await player.focus();

    await page.keyboard.press('f');
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement)), { timeout: 5_000 }).toBe(true);
    await page.keyboard.press('f');
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement)), { timeout: 5_000 }).toBe(false);
  });
});
