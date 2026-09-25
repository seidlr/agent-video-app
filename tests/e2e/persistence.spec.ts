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

/**
 * Reproduces this plan's own top-level Verification bullet #2 verbatim: "After a reload ... the
 * last project, its video, frames, boxes, notes and transcript are all still present and
 * playable." Every entity here (notes/chapters/boxes/frames) was previously written to Dexie by
 * its own tool (or never written at all -- notes/chapters/boxes) but never read back on boot; see
 * store/projectPersistence.ts's own doc comment and the plan's Task 9 Deviations entry for the
 * evidence trail. Transcript is covered separately (it is keyed by assetId, restored only once the
 * source itself resolves) since transcribing a real fixture here would need a Whisper download.
 */
test.describe('reload persistence (Verification bullet #2)', () => {
  test('notes, chapters, boxes, and frames all survive a full page reload for a local file source', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Panels' }).getByRole('button', { name: 'Library', exact: true }).click();
    await page.setInputFiles('#video-file', FIXTURE_PATH);
    await expect(page.locator('header b')).toHaveText('cuts.mp4', { timeout: 15_000 });
    await expect.poll(() => duration(page), { timeout: 15_000 }).toBeGreaterThan(7);

    const note = await execTool(page, 'add_note', { time: '1', text: 'reload-survives-note' });
    expect(note.ok).toBe(true);
    const chapter = await execTool(page, 'add_chapter', { start: '0', end: '2', title: 'reload-survives-chapter' });
    expect(chapter.ok).toBe(true);
    const box = await execTool(page, 'add_box', { time: '1', x: 0.1, y: 0.1, w: 0.2, h: 0.2, label: 'reload-survives-box' });
    expect(box.ok).toBe(true);
    const frame = await execTool(page, 'capture_frame', { time: '1' });
    expect(frame.ok).toBe(true);

    await page.reload();

    // No re-selecting the file: main.tsx restores the last-loaded source from Dexie/OPFS on boot
    // (Task 3), and the same reload now also restores notes/chapters/boxes/frames (Task 9).
    await expect(page.locator('header b')).toHaveText('cuts.mp4', { timeout: 15_000 });
    await expect.poll(() => duration(page), { timeout: 15_000 }).toBeGreaterThan(7);

    const notesAfter = await execTool(page, 'list_notes');
    expect((notesAfter.notes as { text: string }[]).some((n) => n.text === 'reload-survives-note')).toBe(true);

    const chaptersAfter = await execTool(page, 'list_chapters');
    expect((chaptersAfter.chapters as { title: string }[]).some((c) => c.title === 'reload-survives-chapter')).toBe(true);

    const boxesAfter = await execTool(page, 'list_boxes');
    expect((boxesAfter.boxes as { label: string }[]).some((b) => b.label === 'reload-survives-box')).toBe(true);

    const framesAfter = await execTool(page, 'list_frames');
    expect((framesAfter.frames as unknown[]).length).toBeGreaterThanOrEqual(1);

    // The restored UI, not just the tool-level JSON, actually shows the data (matching this
    // suite's own "interaction evidence" standard elsewhere).
    await page.getByRole('navigation', { name: 'Panels' }).getByRole('button', { name: 'Notes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Seek to note: reload-survives-note' })).toBeVisible();
  });

  test('transcript survives a full page reload @ml', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Panels' }).getByRole('button', { name: 'Library', exact: true }).click();
    await page.setInputFiles('#video-file', FIXTURE_PATH);
    await expect(page.locator('header b')).toHaveText('cuts.mp4', { timeout: 15_000 });
    await expect.poll(() => duration(page), { timeout: 15_000 }).toBeGreaterThan(7);

    const transcribed = await execTool(page, 'transcribe', { model: 'tiny', confirmDownload: true, waitSeconds: 90 });
    expect(transcribed.ok).toBe(true);
    expect((transcribed.segments as unknown[]).length).toBeGreaterThanOrEqual(1);

    await page.reload();
    await expect(page.locator('header b')).toHaveText('cuts.mp4', { timeout: 15_000 });

    const afterReload = await execTool(page, 'get_transcript', { format: 'segments' });
    expect(afterReload.ok).toBe(true);
    expect((afterReload.segments as unknown[]).length).toBeGreaterThanOrEqual(1);
  });
});
