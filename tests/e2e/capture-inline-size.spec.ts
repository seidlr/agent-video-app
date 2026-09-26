import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function execTool(page: Page, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  await page.waitForFunction((toolName) => navigator.modelContextTesting?.listTools().some((t) => t.name === toolName) ?? false, name);
  const resultJson = await page.evaluate(
    async ({ name, argsJson }) => navigator.modelContextTesting!.executeTool(name, argsJson),
    { name, argsJson: JSON.stringify(args) },
  );
  return JSON.parse(resultJson ?? 'null') as Record<string, unknown>;
}

/** Bytes a base64 data URL decodes to. */
function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.floor((base64.length * 3) / 4);
}

/**
 * Found live in a Claude chat: capture_frame's image came back as a full-size 1280x720 PNG and
 * Claude refused it ("tool result too large", its limit is 1 MB). The image returned inline has to
 * fit whatever the frame is; the stored and downloaded frame keeps full quality.
 */
test('an inline capture of a detailed 1280x720 frame fits the inline budget and still decodes', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  expect(await execTool(page, 'load_video', { source: 'sample', id: 'sprite-fight' })).toMatchObject({ ok: true });
  await execTool(page, 'seek', { time: '1:24' });

  const captured = await execTool(page, 'capture_frame', { includeDataUrl: true });
  expect(captured).toMatchObject({ ok: true, width: 1280, height: 720 });
  const dataUrl = captured.dataUrl as string;
  expect(dataUrlBytes(dataUrl)).toBeLessThan(600 * 1024);

  const decoded = await page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { w: img.naturalWidth, h: img.naturalHeight };
  }, dataUrl);
  expect(decoded.w).toBeGreaterThan(0);
  expect(decoded.h).toBeGreaterThan(0);
});
