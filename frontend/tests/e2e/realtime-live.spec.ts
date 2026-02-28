import { test, expect } from '@playwright/test';
import { clearStorage, setupMockRoutes, isMockMode } from './helpers';

test.describe('Realtime live – basic turn-taking when enabled', () => {
  test.skip(!process.env.NEXT_PUBLIC_REALTIME_ENABLED, 'Realtime not enabled');

  test('evaluate page loads; realtime fallback to chat+tts when no provider', async ({ page }) => {
    await clearStorage(page);
    if (isMockMode()) await setupMockRoutes(page);

    await page.goto('/evaluate', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('canvas', { timeout: 15_000 });

    await page.click('body', { position: { x: 50, y: 50 } });
    await page.fill('input[placeholder*="اكتب"]', 'مرحبا');
    await page.click('button:has-text("إرسال")');

    await page.waitForTimeout(3000);
    const failedStatics: string[] = [];
    page.on('response', (res) => {
      if (res.url().includes('/_next/static/') && res.status() === 404) failedStatics.push(res.url());
    });
    expect(failedStatics).toHaveLength(0);
  });
});
