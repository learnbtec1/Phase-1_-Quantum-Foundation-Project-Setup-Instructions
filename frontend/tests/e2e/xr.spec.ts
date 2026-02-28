import { test, expect } from '@playwright/test';

test('XR enter/exit does not break rendering (smoke)', async ({ page }) => {
  await page.goto('/evaluate', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { timeout: 60_000 });
  const canvas = page.locator('canvas');
  expect(await canvas.count()).toBeGreaterThan(0);
});
