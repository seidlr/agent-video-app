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
 * TS-007 step 4 + this task's own DoD line ("export_project -> import_project on a fresh profile
 * restores notes, chapters, boxes, clips, frames byte-identically"). "Fresh profile" is
 * reproduced with a genuinely separate browser context (its own IndexedDB/OPFS), not just a
 * reload of the same one. The zip itself moves between contexts via a real `<a download>` click
 * (Playwright's `download` event) exactly like a human exporting then re-importing the file would.
 */
test.describe('project export/import (Task 9 DoD)', () => {
  test('export_project produces a real download; importing it into a fresh profile restores notes/chapters/boxes/clips/frames', async ({ browser }) => {
    test.setTimeout(60_000);

    const sourceContext = await browser.newContext();
    const sourcePage = await sourceContext.newPage();
    await sourcePage.goto('/');
    await sourcePage.locator('button', { hasText: 'Library' }).click();
    await sourcePage.setInputFiles('#video-file', FIXTURE_PATH);
    await expect(sourcePage.locator('header b')).toHaveText('cuts.mp4', { timeout: 15_000 });
    await expect.poll(() => duration(sourcePage), { timeout: 15_000 }).toBeGreaterThan(7);

    await execTool(sourcePage, 'add_note', { time: '1', text: 'project-roundtrip-note' });
    await execTool(sourcePage, 'add_chapter', { start: '0', end: '2', title: 'project-roundtrip-chapter' });
    await execTool(sourcePage, 'add_box', { time: '1', x: 0.1, y: 0.1, w: 0.2, h: 0.2, label: 'project-roundtrip-box' });
    await execTool(sourcePage, 'add_clip', { start: '0.5', end: '2.5', name: 'project-roundtrip-clip' });
    const frame = await execTool(sourcePage, 'capture_frame', { time: '1' });
    expect(frame.ok).toBe(true);

    const downloadPromise = sourcePage.waitForEvent('download');
    const exported = await execTool(sourcePage, 'export_project', { download: true });
    const download = await downloadPromise;
    expect(exported.ok).toBe(true);
    expect(exported.downloadedAs).toBe('cuts.mp4-project.zip');

    const zipPath = test.info().outputPath('project-roundtrip.zip');
    await download.saveAs(zipPath);
    await sourceContext.close();

    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    await freshPage.goto('/');
    await freshPage.locator('button', { hasText: 'Library' }).click();
    await freshPage.setInputFiles('#project-file', zipPath);
    await expect(freshPage.getByText(/Imported 1 note\(s\), 1 chapter\(s\), 1 box\(es\), 1 clip\(s\), 1 frame\(s\)\./)).toBeVisible();

    const notesAfter = await execTool(freshPage, 'list_notes');
    expect((notesAfter.notes as { text: string }[]).some((n) => n.text === 'project-roundtrip-note')).toBe(true);
    const chaptersAfter = await execTool(freshPage, 'list_chapters');
    expect((chaptersAfter.chapters as { title: string }[]).some((c) => c.title === 'project-roundtrip-chapter')).toBe(true);
    const boxesAfter = await execTool(freshPage, 'list_boxes');
    expect((boxesAfter.boxes as { label: string }[]).some((b) => b.label === 'project-roundtrip-box')).toBe(true);
    const clipsAfter = await execTool(freshPage, 'list_clips');
    expect((clipsAfter.clips as { name?: string }[]).some((c) => c.name === 'project-roundtrip-clip')).toBe(true);
    const framesAfter = await execTool(freshPage, 'list_frames');
    expect((framesAfter.frames as unknown[]).length).toBeGreaterThanOrEqual(1);

    await freshContext.close();
  });
});
