import { expect, test } from '@playwright/test';

test('the app renders with the design tokens applied and no console errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto('/');
  await expect(page.locator('header').getByText('Agent', { exact: true })).toBeVisible();

  const bodyBg = await page.evaluate(() => {
    const styles = getComputedStyle(document.body);
    return { bg: styles.backgroundColor, tokenBg: getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() };
  });

  // Task 1 light-theme token: --color-bg: #f5f1eb -> rgb(245, 241, 235)
  expect(bodyBg.tokenBg.toLowerCase()).toBe('#f5f1eb');
  expect(bodyBg.bg).toBe('rgb(245, 241, 235)');

  expect(consoleErrors).toEqual([]);
});
