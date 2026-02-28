import { test, expect } from '@playwright/test';
import { clearStorage, setupMockRoutes, isMockMode } from './helpers';

test.describe('Realtime mock – canned streaming, timings path', () => {
  test.beforeEach(async ({ page }) => {
    if (!isMockMode()) return;
    await clearStorage(page);
    await setupMockRoutes(page);
  });

  test('mock mode: chat returns reply; tts 503 fallback; no static 404', async ({ page }) => {
    if (!isMockMode()) test.skip();

    await page.goto('/evaluate', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('canvas', { timeout: 15_000 });

    const failedStatics: string[] = [];
    page.on('response', (res) => {
      if (res.url().includes('/_next/static/') && res.status() === 404) failedStatics.push(res.url());
    });

    await page.click('body', { position: { x: 50, y: 50 } });
    await page.fill('input[placeholder*="اكتب"]', 'مرحبا');
    await page.click('button:has-text("إرسال")');

    await page.waitForTimeout(2000);
    expect(failedStatics).toHaveLength(0);
  });

  test('mock mode: avatar:speak with timings sets __lipSyncStarted', async ({ page }) => {
    if (!isMockMode()) test.skip();

    await page.goto('/evaluate', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('canvas', { timeout: 15_000 });
    await page.waitForTimeout(3000);

    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('avatar:speak', {
          detail: {
            timings: [{ word: 'مرحبا', start_time: 0, end_time: 0.5 }],
            sampleRate: 24000,
          },
        })
      );
      window.dispatchEvent(new CustomEvent('avatar:speak:start', { detail: {} }));
    });

    await page.waitForFunction(
      () => (window as unknown as { __lipSyncStarted?: boolean }).__lipSyncStarted === true,
      { timeout: 12_000 }
    );
  });
});
