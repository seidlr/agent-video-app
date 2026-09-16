import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Same waiting discipline as tests/e2e/tools-playback.spec.ts's execTool: wait for the exact
 * tool name about to be called, since the polyfill installing navigator.modelContextTesting
 * doesn't mean every mountWebMcp() registerTool() call has landed yet. */
async function execTool(page: Page, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  await page.waitForFunction((toolName) => navigator.modelContextTesting?.listTools().some((t) => t.name === toolName) ?? false, name);
  const resultJson = await page.evaluate(
    async ({ name, argsJson }) => navigator.modelContextTesting!.executeTool(name, argsJson),
    { name, argsJson: JSON.stringify(args) },
  );
  return JSON.parse(resultJson ?? 'null') as Record<string, unknown>;
}

async function openNotesTab(page: Page): Promise<void> {
  await page.locator('button', { hasText: 'Notes' }).first().click();
}

/** Polls the exposed dev-only store (window.__studioStore, wired in src/main.tsx), same pattern
 * as tests/e2e/player.spec.ts's own currentTime helper. */
async function currentTime(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __studioStore: { getState(): { player: { currentTime: number } } } }).__studioStore.getState().player.currentTime);
}

test.describe('notes, chapters, and exports (Task 6 DoD, TS-004)', () => {
  test('add_note/add_chapter show up as timeline markers and panel rows; export_notes renders every format', async ({ page }) => {
    await page.goto('/');
    await page.locator('button', { hasText: 'Library' }).click();
    await page.locator('button', { hasText: 'Sprite Fight' }).click();
    await expect(page.locator('header b')).toHaveText('Sprite Fight');

    // Step 1: a point note and a region note.
    const pointNote = await execTool(page, 'add_note', { time: '1.5', text: 'Red scene starts', tags: ['scene'] });
    expect(pointNote).toMatchObject({ ok: true });
    const regionNote = await execTool(page, 'add_note', { time: '3', end: '4', text: 'Blue region' });
    expect(regionNote).toMatchObject({ ok: true });

    await expect(page.getByRole('button', { name: 'Seek to note: Red scene starts' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Seek to note region: Blue region' })).toBeVisible();

    // DoD: "markers seek on click" -- clicking the point-note marker actually moves the playhead.
    await page.getByRole('button', { name: 'Seek to note: Red scene starts' }).click();
    await expect.poll(() => currentTime(page)).toBeCloseTo(1.5, 0);

    await openNotesTab(page);
    await expect(page.getByText('Red scene starts')).toBeVisible();
    await expect(page.getByText('Blue region')).toBeVisible();
    await expect(page.getByRole('button', { name: /00:01\.500.*Red scene starts/ })).toBeVisible(); // the Notes tab's own row, with its mono timestamp

    // Step 2: a chapter -- tick on timeline, panel row, and FrameLabel at t=1.
    const chapter = await execTool(page, 'add_chapter', { start: 0, end: 2, title: 'Red' });
    expect(chapter).toMatchObject({ ok: true });
    await expect(page.getByRole('button', { name: 'Seek to chapter Red' })).toBeVisible();

    await page.locator('button', { hasText: 'Chapters' }).last().click(); // the Notes panel's own Notes/Chapters sub-tab
    await expect(page.getByRole('button', { name: /00:02\.000.*Red/ })).toBeVisible(); // the Chapters tab's own row

    await execTool(page, 'seek', { time: '1' });
    await expect(page.getByText('SCENE 01 · RED', { exact: false })).toBeVisible();

    // Step 3: export_notes markdown contains every documented fragment.
    const markdown = await execTool(page, 'export_notes', { format: 'markdown' });
    expect(markdown.ok).toBe(true);
    const markdownText = markdown.text as string;
    for (const fragment of ['## Chapters', '- [00:00.000 → 00:02.000] Red', '## Notes', '- [00:01.500] Red scene starts #scene', '- [00:03.000 → 00:04.000] Blue region']) {
      expect(markdownText).toContain(fragment);
    }

    // Step 4: srt/edl/csv each render their own documented shape.
    const srt = await execTool(page, 'export_notes', { format: 'srt' });
    const srtText = srt.text as string;
    expect(srtText).toContain('1\n');
    expect(srtText).toContain('2\n');
    expect(srtText.match(/-->/g)).toHaveLength(2);

    const edl = await execTool(page, 'export_notes', { format: 'edl' });
    const edlText = edl.text as string;
    expect(edlText).toContain('TITLE:');
    expect(edlText).toContain('V     C');

    const csv = await execTool(page, 'export_notes', { format: 'csv' });
    const csvText = csv.text as string;
    const csvLines = csvText.trim().split('\n');
    expect(csvLines[0]).toBe('type,start,end,label,tags');
    expect(csvLines).toHaveLength(4); // header + chapter + 2 notes

    // Step 5: clicking "Download" next to Markdown in the Notes panel matches step 3's text.
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Markdown' }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const fs = await import('node:fs/promises');
    const downloadedText = await fs.readFile(downloadPath as string, 'utf-8');
    expect(downloadedText).toBe(markdownText);
  });
});

/** Injects a Task 12 vision result the same shape describe_frame/ask_about_frame/describe_range
 * produce, without a real VLM call -- the Vision panel's "Add as note"/"Add as chapter title"
 * promotion buttons don't depend on how the text got there, so this exercises that UI wiring
 * directly and quickly rather than duplicating vlm.spec.ts's own (slow, real-model) coverage. */
async function addVisionResult(page: Page, input: { time: number; kind: string; text: string; model: string }): Promise<void> {
  await page.evaluate(
    (r) => (window as unknown as { __studioStore: { getState(): { addVisionResult(input: typeof r): string } } }).__studioStore.getState().addVisionResult(r),
    input,
  );
}

test.describe('Vision panel: promoting a VLM result to a note or chapter (Task 12 DoD)', () => {
  test('"Add as note" and "Add as chapter title" create a real note and chapter from a vision result', async ({ page }) => {
    await page.goto('/');
    await page.locator('button', { hasText: 'Library' }).click();
    await page.locator('button', { hasText: 'Sprite Fight' }).click();
    await expect(page.locator('header b')).toHaveText('Sprite Fight');

    await addVisionResult(page, { time: 1.5, kind: 'describe', text: 'A red scene with a moving white square', model: 'vlm-default' });

    await page.locator('button', { hasText: 'Vision' }).click();
    await expect(page.getByText('A red scene with a moving white square')).toBeVisible();
    await expect(page.getByText('Frame description', { exact: false })).toBeVisible();

    await page.locator('button', { hasText: 'Add as note' }).click();
    await expect(page.getByText('Added!').first()).toBeVisible();

    await page.locator('button', { hasText: 'Notes' }).first().click();
    await expect(page.getByText('A red scene with a moving white square')).toBeVisible();
    await expect(page.getByRole('button', { name: /00:01\.500.*A red scene/ })).toBeVisible();

    await page.locator('button', { hasText: 'Vision' }).click();
    await page.locator('button', { hasText: 'Add as chapter title' }).click();
    await expect(page.getByText('Added!').first()).toBeVisible();

    await page.locator('button', { hasText: 'Notes' }).first().click();
    await page.locator('button', { hasText: 'Chapters' }).last().click();
    await expect(page.getByRole('button', { name: /00:01\.500.*A red scene with a moving white square/ })).toBeVisible();
  });
});
