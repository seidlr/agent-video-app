import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, '../fixtures/cuts.mp4');

test.describe('video stage', () => {
  // Boxes/masks are positioned as percentages of the stage container (BoxOverlay.tsx), so they only
  // line up with what they annotate when the <video> fills that same container. The 640x360 fixture
  // is smaller than the stage, which is what exposes a video left at its intrinsic size.
  test('the video fills the stage, so normalized overlay coordinates line up with the picture', async ({ page }) => {
    await page.goto('/');
    await page.locator('button', { hasText: 'Library' }).click();
    await page.setInputFiles('#video-file', FIXTURE_PATH);
    await expect(page.locator('video')).toBeVisible();

    const rects = await page.evaluate(() => {
      const stage = document.querySelector('[data-testid="video-stage"]')!.getBoundingClientRect();
      const video = document.querySelector('video')!.getBoundingClientRect();
      return { stage: { w: stage.width, h: stage.height }, video: { w: video.width, h: video.height } };
    });
    expect(rects.video.w).toBeCloseTo(rects.stage.w, 0);
    expect(rects.video.h).toBeCloseTo(rects.stage.h, 0);
  });
});
