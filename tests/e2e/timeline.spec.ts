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
    await page.locator('button', { hasText: 'Library' }).click();
    await page.setInputFiles('#video-file', FIXTURE_PATH);
    await expect.poll(() => page.evaluate(() => (window as unknown as StudioWindow).__studioStore.getState().player.duration), { timeout: 20_000 }).toBeGreaterThan(0);

    await page.evaluate(() => (window as unknown as StudioWindow).__studioStore.getState().seek(4));

    await expect
      .poll(async () => (await timelineGeometry(page)).fillFraction, { timeout: 10_000 })
      .toBeCloseTo(4 / FIXTURE_DURATION, 1);
    expect((await timelineGeometry(page)).thumbCenterFraction).toBeCloseTo(4 / FIXTURE_DURATION, 1);
  });

  test('with chapters, segments are sized by duration and each fills by its own progress', async ({ page }) => {
    await page.goto('/');
    await page.locator('button', { hasText: 'Library' }).click();
    await page.setInputFiles('#video-file', FIXTURE_PATH);
    await expect.poll(() => page.evaluate(() => (window as unknown as StudioWindow).__studioStore.getState().player.duration), { timeout: 20_000 }).toBeGreaterThan(0);

    const call = (name: string, args: object): Promise<unknown> =>
      page.evaluate(([n, a]) => (navigator as unknown as { modelContextTesting: { executeTool(n: string, a: string): Promise<unknown> } }).modelContextTesting.executeTool(n as string, JSON.stringify(a)), [name, args]);
    await call('add_chapter', { start: 0, end: 3, title: 'Intro' });
    await call('add_chapter', { start: 3, end: 8, title: 'Rest' });
    await call('seek', { time: 5 });

    // Chapter 1 (0-3s of 8s) is fully passed; chapter 2 (3-8s) is 2 of its 5 seconds in.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const tracks = [...document.querySelectorAll('[data-testid="timeline-chapter-track"]')].map((el) => el.getBoundingClientRect().width);
            const fills = [...document.querySelectorAll('[data-testid="timeline-chapter-fill"]')].map((el) => el.getBoundingClientRect().width);
            return { widthRatio: tracks[0]! / tracks[1]!, firstFill: fills[0]! / tracks[0]!, secondFill: fills[1]! / tracks[1]! };
          }),
        { timeout: 10_000 },
      )
      .toMatchObject({ widthRatio: expect.closeTo(3 / 5, 1), firstFill: expect.closeTo(1, 1), secondFill: expect.closeTo(2 / 5, 1) });
  });
});
