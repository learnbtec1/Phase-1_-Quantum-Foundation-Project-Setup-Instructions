import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test('should load without errors', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await expect(page).toHaveTitle(/Nexus|Quantum|BTEC|تسجيل/i);
    
    // Check for console errors
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    await page.waitForLoadState('networkidle');
    expect(errors.length).toBe(0);
  });
});
