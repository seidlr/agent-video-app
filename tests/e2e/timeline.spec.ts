import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, '../fixtures/cuts.mp4');
const FIXTURE_DURATION = 8;

type StudioWindow = { __studioStore: { getState(): { player: { duration: number }; seek(t: number): Promise<void> } } };

/** The fill/track/thumb are 0-width unless the stylesheet maps vidstack's `--slider-fill`/
 * `--slider-progress` CSS variables onto them (they are only variables, not layout), so this reads
 * their real rendered geometry rather than the variables or the store's own numbers. */
async function timelineGeometry(page: Page): Promise<{ fillFraction: number; thumbCenterFraction: number }> {
  return page.evaluate(() => {
    const track = document.querySelector('[data-testid="timeline-track"]')!.getBoundingClientRect();
    const fill = document.querySelector('[data-testid="timeline-fill"]')!.getBoundingClientRect();
    const thumb = document.querySelector('[data-testid="timeline-thumb"]')!.getBoundingClientRect();
    return {
      fillFraction: fill.width / track.width,
      thumbCenterFraction: (thumb.left + thumb.width / 2 - track.left) / track.width,
    };
  });
}

test.describe('timeline reflects seeks', () => {
  test('a seek moves the timeline fill and playhead to the matching position', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Panels' }).getByRole('button', { name: 'Library', exact: true }).click();
    await page.setInputFiles('#video-file', FIXTURE_PATH);
    await expect.poll(() => page.evaluate(() => (window as unknown as StudioWindow).__studioStore.getState().player.duration), { timeout: 20_000 }).toBeGreaterThan(0);

    await page.evaluate(() => (window as unknown as StudioWindow).__studioStore.getState().seek(4));

    await expect
      .poll(async () => (await timelineGeometry(page)).fillFraction, { timeout: 10_000 })
      .toBeCloseTo(4 / FIXTURE_DURATION, 1);
    expect((await timelineGeometry(page)).thumbCenterFraction).toBeCloseTo(4 / FIXTURE_DURATION, 1);
  });

  test('with chapters, the chapter lane sizes blocks by duration, highlights the current one, and the scrub fill stays continuous', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Panels' }).getByRole('button', { name: 'Library', exact: true }).click();
    await page.setInputFiles('#video-file', FIXTURE_PATH);
    await expect.poll(() => page.evaluate(() => (window as unknown as StudioWindow).__studioStore.getState().player.duration), { timeout: 20_000 }).toBeGreaterThan(0);

    const call = (name: string, args: object): Promise<unknown> =>
      page.evaluate(([n, a]) => (navigator as unknown as { modelContextTesting: { executeTool(n: string, a: string): Promise<unknown> } }).modelContextTesting.executeTool(n as string, JSON.stringify(a)), [name, args]);
    // Added one at a time, the way an agent builds chapters -- vidstack's own segmented chapter
    // bar kept stale fills across exactly this sequence, which is why the scrub track stays plain.
    await call('add_chapter', { start: 0, end: 3, title: 'Intro' });
    await call('add_chapter', { start: 3, end: 5, title: 'Middle' });
    await call('add_chapter', { start: 5, end: 8, title: 'Rest' });
    await call('seek', { time: 4 });

    const intro = page.getByRole('button', { name: 'Seek to chapter Intro' });
    const middle = page.getByRole('button', { name: 'Seek to chapter Middle' });
    await expect(middle).toHaveClass(/bg-clay-soft/, { timeout: 10_000 });
    await expect(intro).not.toHaveClass(/bg-clay-soft/);

    const widths = await page.evaluate(() =>
      ['Intro', 'Middle', 'Rest'].map((t) => document.querySelector(`[aria-label="Seek to chapter ${t}"]`)!.getBoundingClientRect().width),
    );
    expect(widths[0]! / widths[2]!).toBeCloseTo(1, 1);
    expect(widths[1]! / widths[2]!).toBeCloseTo(2 / 3, 1);

    await expect.poll(async () => (await timelineGeometry(page)).fillFraction, { timeout: 10_000 }).toBeCloseTo(4 / FIXTURE_DURATION, 1);
  });
});
